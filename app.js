/**
 * 台灣環島五大商港即時潮位系統 - 核心前端應用程式
 * 涵蓋港口：台北港、基隆港、花蓮港、高雄港、台中港
 * 功能：Leaflet 地圖整合、五港旁即時潮位浮動卡片、潮位動態推算、24H天文潮位曲線、五大商港環島巡航、近海船難海污擴散模擬
 * 資料參考：交通部中央氣象署 (CWA)
 */

// 近海假設船難沉沒情境預設資料集 (Oil Spill Incident Presets)
const SPILL_PRESETS = {
  taipei: {
    name: "台北港近海",
    ship: "巴拿馬籍三萬噸散裝輪「海運之星」",
    coords: [25.1950, 121.3200],
    depth: "28 米",
    cargo: "裝載 2,400 噸重柴油，船體觸礁破裂沉沒",
    nearestPortId: "taipei",
    coastDesc: "新北八里/淡水外海約 4.8 海浬"
  },
  keelung: {
    name: "基隆港近海",
    ship: "賴比瑞亞籍兩萬噸貨櫃輪「凱旋輪」",
    coords: [25.1750, 121.7850],
    depth: "45 米",
    cargo: "外海碰撞沉沒，重燃油日用油槽破裂外洩",
    nearestPortId: "keelung",
    coastDesc: "基隆港/野柳外海約 4.2 海浬"
  },
  taichung: {
    name: "台中港近海",
    ship: "獅子山籍成品化學油輪「宏泰號」",
    coords: [24.3200, 120.4300],
    depth: "32 米",
    cargo: "強烈湧浪致舵機失靈進水沉沒，重柴油外漏",
    nearestPortId: "taichung",
    coastDesc: "台中港/清水外海約 5.5 海浬"
  },
  kaohsiung: {
    name: "高雄港近海",
    ship: "宏都拉斯籍散裝雜貨輪「順達輪」",
    coords: [22.5800, 120.2100],
    depth: "36 米",
    cargo: "移泊觸礁船體破裂沉沒，油櫃破裂海面大量浮油",
    nearestPortId: "kaohsiung",
    coastDesc: "高雄港二港口外海約 4.5 海浬"
  },
  hualien: {
    name: "花蓮港近海",
    ship: "貝里斯籍水泥砂石輪「東運輪」",
    coords: [24.0300, 121.6850],
    depth: "85 米",
    cargo: "主機故障漂流沉沒，受黑潮強流牽引迅速北漂",
    nearestPortId: "hualien",
    coastDesc: "花蓮港/七星潭外海約 4.0 海浬"
  }
};

class TaiwanTideApp {
  constructor() {
    this.map = null;
    this.markers = {};
    this.selectedPortId = "taipei"; // 預設選中台北港
    this.currentDatum = "chart_datum"; // chart_datum | twvd | msl
    this.currentPortFilter = "all"; // all | taipei | keelung | taichung | kaohsiung | hualien
    this.searchQuery = "";
    this.now = new Date();

    // 船難原油外洩污染擴散模擬狀態 (左側欄位優先啟動，僅保留地圖點選沉船)
    this.spillSim = {
      isOpen: true,
      isMinimized: false,
      origin: [25.2000, 121.3200],
      shipName: "近海事故遇險船舶",
      cargoDesc: "假設此海域發生船難進水沉沒，油料破裂外洩",
      preset: "custom",
      volume: 300, // 預設 300 公噸
      hours: 6, // 經過 6 小時
      isPlaying: false,
      playTimer: null,
      isDroppingPin: true // 預設常駐啟用「地圖點選沉船」模式
    };
    this.spillLayerGroup = null;

    this.init();
  }

  init() {
    this.initMap();
    this.initClock();
    this.initEventListeners();
    this.renderPortsList();
    this.renderMapMarkers();
    this.renderBottomPills();
    this.selectPort(this.selectedPortId, false);
    this.initSpillSimulation();

    // 每 1 秒鐘即時更新潮位數值與時鐘
    setInterval(() => {
      this.now = new Date();
      this.updateClock();
      this.updateAllTideLevels();
    }, 1000);
  }

  /* -------------------------------------------------------------
     1. 地圖初始化 (Leaflet)
     ------------------------------------------------------------- */
  initMap() {
    // 臺灣中心經緯度，完整包容五大商港
    this.map = L.map("map", {
      center: [23.95, 121.0],
      zoom: 7.8,
      minZoom: 6,
      maxZoom: 16,
      zoomControl: false
    });

    // 縮放控制項置於右下角
    L.control.zoom({ position: "bottomright" }).addTo(this.map);

    // 1. 臺灣通用電子地圖 (內政部國土測繪中心 NLSC) - 臺灣官方高精度全彩地圖，穩定迅速、無任何浮水印、免 API Key
    const nlscEmapLayer = L.tileLayer("https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}", {
      attribution: '&copy; <a href="https://maps.nlsc.gov.tw" target="_blank">內政部國土測繪中心 NLSC</a> | 潮位：<a href="https://www.cwa.gov.tw" target="_blank">中央氣象署</a>',
      maxZoom: 19
    });

    // 2. 深色海事底圖 (Esri World Dark Gray Canvas) - 高清深色無任何浮水印、免 API Key
    const darkTileLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      attribution: '&copy; <a href="https://www.esri.com" target="_blank">Esri</a> | 潮位：<a href="https://www.cwa.gov.tw" target="_blank">中央氣象署</a>',
      maxZoom: 16
    });

    // 3. OpenStreetMap 標準全彩底圖 - 免 API Key、無浮水印
    const osmLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
      maxZoom: 19
    });

    // 預設使用臺灣通用電子地圖 (NLSC)
    nlscEmapLayer.addTo(this.map);

    // 4. 加入臺灣本島與離島高清晰向量圖框圖層 (Taiwan GeoJSON Vector Frame)
    if (typeof TAIWAN_GEOJSON !== 'undefined') {
      this.taiwanVectorLayer = L.geoJSON(TAIWAN_GEOJSON, {
        style: () => ({
          fillColor: '#0a1936',
          fillOpacity: 0.15,
          color: '#00c4df',
          weight: 2,
          opacity: 0.95
        }),
        onEachFeature: (feature, layer) => {
          const countyName = feature.properties.name_zh || feature.properties.name;
          layer.bindTooltip(countyName, {
            permanent: false,
            direction: 'center',
            className: 'county-tooltip'
          });
          layer.on({
            mouseover: (e) => {
              const l = e.target;
              l.setStyle({
                fillColor: '#1d4ed8',
                fillOpacity: 0.35,
                color: '#38bdf8',
                weight: 2.8
              });
            },
            mouseout: (e) => {
              this.taiwanVectorLayer.resetStyle(e.target);
            }
          });
        }
      }).addTo(this.map);
    }

    this.baseLayers = {
      "臺灣通用電子地圖 (內政部NLSC，預設)": nlscEmapLayer,
      "海事深色底圖 (Esri Dark Canvas)": darkTileLayer,
      "OpenStreetMap 全彩地圖": osmLayer
    };

    const overlays = {};
    if (this.taiwanVectorLayer) {
      overlays["臺灣向量圖框 (邊界與離島)"] = this.taiwanVectorLayer;
    }

    L.control.layers(this.baseLayers, overlays, { position: "bottomright" }).addTo(this.map);

    // 船難原油外洩污染擴散專用向量圖層群組
    this.spillLayerGroup = L.layerGroup().addTo(this.map);

    // 地圖點擊事件（支援自訂沉船地點點選）
    this.map.on("click", (e) => {
      if (this.spillSim && this.spillSim.isDroppingPin) {
        this.handleMapClickForPinDrop(e.latlng);
      }
    });

    // 確保容器尺寸自適應並置中五大商港
    setTimeout(() => {
      this.map.invalidateSize();
      this.map.fitBounds([
        [22.2, 119.8],
        [25.5, 122.2]
      ]);
    }, 200);

    window.addEventListener("resize", () => {
      this.map.invalidateSize();
    });
  }

  /* -------------------------------------------------------------
     2. 時鐘與即時潮位推算核心算法 (Astronomical Tide Calculation)
     ------------------------------------------------------------- */
  initClock() {
    this.updateClock();
  }

  updateClock() {
    const timeEl = document.getElementById("live-clock-time");
    const dateEl = document.getElementById("live-clock-date");
    if (!timeEl || !dateEl) return;

    const pad = (n) => String(n).padStart(2, "0");
    const hours = pad(this.now.getHours());
    const minutes = pad(this.now.getMinutes());
    const seconds = pad(this.now.getSeconds());

    timeEl.textContent = `${hours}:${minutes}:${seconds}`;

    const days = ["日", "一", "二", "三", "四", "五", "六"];
    const year = this.now.getFullYear();
    const month = pad(this.now.getMonth() + 1);
    const date = pad(this.now.getDate());
    const day = days[this.now.getDay()];

    dateEl.textContent = `${year}/${month}/${date} (${day}) 臺灣標準時`;
  }

  /**
   * 計算特定港口在當前時間點的即時推算潮位、漲退潮狀態與下次極值
   */
  calculateRealtimeTide(port, targetTime = this.now) {
    const tides = port.tides;
    if (!tides || tides.length === 0) {
      return { level: 0, trendText: "平潮", trendIcon: "—", trendClass: "", nextTide: { type: "平潮", timeStr: "--:--" }, countdownStr: "--", progressRatio: 0 };
    }

    const parseTimeToMinutes = (timeStr) => {
      const [h, m] = timeStr.split(":").map(Number);
      return h * 60 + m;
    };

    const currentMinutes = targetTime.getHours() * 60 + targetTime.getMinutes() + targetTime.getSeconds() / 60;

    // 建立 24 小時的潮位循環節點
    const cycleNodes = tides.map((t) => ({
      type: t.type,
      timeStr: t.time,
      minutes: parseTimeToMinutes(t.time),
      level: t[this.currentDatum]
    })).sort((a, b) => a.minutes - b.minutes);

    const firstNode = cycleNodes[0];
    const lastNode = cycleNodes[cycleNodes.length - 1];

    const extendedNodes = [
      { ...lastNode, minutes: lastNode.minutes - 1440 },
      ...cycleNodes,
      { ...firstNode, minutes: firstNode.minutes + 1440 }
    ];

    let prevNode = extendedNodes[0];
    let nextNode = extendedNodes[1];

    for (let i = 0; i < extendedNodes.length - 1; i++) {
      if (currentMinutes >= extendedNodes[i].minutes && currentMinutes <= extendedNodes[i + 1].minutes) {
        prevNode = extendedNodes[i];
        nextNode = extendedNodes[i + 1];
        break;
      }
    }

    // 餘弦調和插值 (Astronomical Cosine Interpolation)
    const duration = nextNode.minutes - prevNode.minutes;
    const elapsed = currentMinutes - prevNode.minutes;
    const progressRatio = Math.max(0, Math.min(1, elapsed / duration));

    const avgLevel = (prevNode.level + nextNode.level) / 2;
    const amp = (prevNode.level - nextNode.level) / 2;
    const interpolatedLevel = avgLevel + amp * Math.cos(Math.PI * progressRatio);

    const isRising = nextNode.level > prevNode.level;
    const trendText = isRising ? "漲潮中" : "退潮中";
    const trendIcon = isRising ? "▲ 🌊" : "▼";
    const trendClass = isRising ? "trend-rising" : "trend-falling";

    const minutesLeft = Math.round(nextNode.minutes - currentMinutes);
    const hoursLeft = Math.floor(minutesLeft / 60);
    const minsRemainder = minutesLeft % 60;
    const countdownStr = hoursLeft > 0 ? `${hoursLeft}小時${minsRemainder}分` : `${minsRemainder}分鐘`;

    return {
      level: Math.round(interpolatedLevel),
      trendText,
      trendIcon,
      trendClass,
      isRising,
      prevTide: prevNode,
      nextTide: nextNode,
      countdownStr,
      progressRatio: Math.round(progressRatio * 100)
    };
  }

  /* -------------------------------------------------------------
     3. 地圖標記與港旁即時潮位卡片 (Requirement 3: 各港旁邊即時顯示潮資料)
     ------------------------------------------------------------- */
  renderMapMarkers() {
    Object.values(this.markers).forEach((m) => this.map.removeLayer(m));
    this.markers = {};

    TIDE_PORTS_DATA.forEach((port) => {
      const markerHtml = this.createPortMarkerHtml(port);

      const customIcon = L.divIcon({
        className: "leaflet-div-icon",
        html: markerHtml,
        iconSize: [0, 0],
        iconAnchor: [0, 0]
      });

      const marker = L.marker(port.coords, {
        icon: customIcon,
        zIndexOffset: 100
      });

      marker.addTo(this.map);

      // 點擊事件：切換選取該港
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        this.selectPort(port.id, true);
      });

      this.markers[port.id] = marker;
    });
  }

  createPortMarkerHtml(port) {
    const isActive = port.id === this.selectedPortId ? "active-port" : "";

    return `
      <div class="port-marker-container cat-major badge-dir-${port.badgeDir} ${isActive}" id="marker-${port.id}">
        <div class="port-pin-beacon" title="點選檢視 ${port.name} 詳細水文">
          <div class="beacon-pulse"></div>
          <div class="beacon-core">⚓</div>
        </div>
        <div class="port-side-badge port-name-only-badge" title="點選檢視 ${port.name} 水文資訊">
          <span class="badge-port-name">${port.name}</span>
        </div>
      </div>
    `;
  }

  updateAllTideLevels() {
    TIDE_PORTS_DATA.forEach((port) => {
      const tideCalc = this.calculateRealtimeTide(port);

      // 更新側邊欄列表數值
      const sidebarItem = document.getElementById(`port-item-${port.id}`);
      if (sidebarItem) {
        const itemLvl = sidebarItem.querySelector(".port-item-level");
        const itemTrend = sidebarItem.querySelector(".port-trend-badge");
        if (itemLvl) {
          const levelSign = tideCalc.level > 0 ? "+" : "";
          itemLvl.textContent = `${levelSign}${tideCalc.level} cm`;
        }
        if (itemTrend) {
          itemTrend.className = `port-trend-badge ${tideCalc.trendClass}`;
          itemTrend.innerHTML = `${tideCalc.trendIcon} ${tideCalc.trendText}`;
        }
      }
    });

    // 更新右側抽屜 Hero 即時潮位
    const selectedPort = TIDE_PORTS_DATA.find((p) => p.id === this.selectedPortId);
    if (selectedPort) {
      this.updateInspectorHero(selectedPort);
    }
  }

  /* -------------------------------------------------------------
     4. 側邊欄列表與搜尋
     ------------------------------------------------------------- */
  renderPortsList() {
    const container = document.getElementById("ports-list-container");
    if (!container) return;

    container.innerHTML = "";

    const filtered = TIDE_PORTS_DATA.filter((p) => {
      if (!this.searchQuery) return true;
      return (
        p.name.includes(this.searchQuery) ||
        p.fullName.includes(this.searchQuery) ||
        p.county.includes(this.searchQuery)
      );
    });

    const countBadge = document.getElementById("ports-count-badge");
    if (countBadge) {
      countBadge.textContent = `${filtered.length} 處國際商港`;
    }

    filtered.forEach((port) => {
      const tideCalc = this.calculateRealtimeTide(port);
      const isActive = port.id === this.selectedPortId ? "active" : "";
      const levelSign = tideCalc.level > 0 ? "+" : "";

      const card = document.createElement("div");
      card.className = `port-item-card ${isActive}`;
      card.id = `port-item-${port.id}`;

      card.innerHTML = `
        <div class="port-item-top">
          <div class="port-name-wrap">
            <span class="port-item-name">${port.name}</span>
            <span class="port-tag-pill tag-major">${port.tag}</span>
          </div>
          <span class="port-item-level">${levelSign}${tideCalc.level} cm</span>
        </div>
        <div class="port-item-bottom">
          <span>${port.county} ${port.town}</span>
          <span class="port-trend-badge ${tideCalc.trendClass}">${tideCalc.trendIcon} ${tideCalc.trendText}</span>
        </div>
      `;

      card.addEventListener("click", () => {
        this.selectPort(port.id, true);
      });

      container.appendChild(card);
    });
  }

  renderBottomPills() {
    const bar = document.getElementById("bottom-ports-bar");
    if (!bar) return;

    bar.innerHTML = "";

    TIDE_PORTS_DATA.forEach((port) => {
      const tideCalc = this.calculateRealtimeTide(port);
      const pill = document.createElement("button");
      pill.className = `quick-port-pill ${port.id === this.selectedPortId ? "active" : ""}`;
      pill.id = `quick-pill-${port.id}`;

      const levelSign = tideCalc.level > 0 ? "+" : "";
      pill.innerHTML = `
        <span>⚓ ${port.name}</span>
        <span class="quick-pill-lvl">${levelSign}${tideCalc.level}cm</span>
      `;

      pill.addEventListener("click", () => {
        this.selectPort(port.id, true);
      });

      bar.appendChild(pill);
    });
  }

  /* -------------------------------------------------------------
     5. 選取港口與詳細水文分析抽屜 (Right Inspector)
     ------------------------------------------------------------- */
  selectPort(portId, flyTo = true) {
    this.selectedPortId = portId;
    const port = TIDE_PORTS_DATA.find((p) => p.id === portId);
    if (!port) return;

    // 視覺高亮
    document.querySelectorAll(".port-marker-container").forEach((el) => el.classList.remove("active-port"));
    const markerEl = document.getElementById(`marker-${portId}`);
    if (markerEl) markerEl.classList.add("active-port");

    document.querySelectorAll(".port-item-card").forEach((el) => el.classList.remove("active"));
    const itemEl = document.getElementById(`port-item-${portId}`);
    if (itemEl) {
      itemEl.classList.add("active");
      itemEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    document.querySelectorAll(".quick-port-pill").forEach((el) => el.classList.remove("active"));
    const pillEl = document.getElementById(`quick-pill-${portId}`);
    if (pillEl) pillEl.classList.add("active");

    // 更新頂部商港按鈕樣式
    document.querySelectorAll(".filter-btn-group .ctrl-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.port === portId);
    });

    // 平滑飛行至該港
    if (flyTo) {
      this.map.flyTo(port.coords, 11, {
        duration: 1.2,
        easeLinearity: 0.25
      });
      // 點選商港時展開右側商港水文抽屜 (左側海污模擬維持運作無衝突)
      const drawer = document.getElementById("map-overlay-right");
      if (drawer) {
        drawer.classList.remove("hidden");
      }
    }

    // 渲染右側詳細抽屜
    this.renderInspectorDrawer(port);
  }

  renderInspectorDrawer(port) {
    const drawer = document.getElementById("map-overlay-right");
    if (!drawer) return;

    // 標題資訊
    document.getElementById("inspector-port-name").innerHTML = `
      ${port.name} <span class="badge-port-tag tag-major">${port.tag}</span>
    `;
    document.getElementById("inspector-port-sub").textContent = `${port.fullName} ｜ CWA 測站代碼：${port.cwaStationId}`;

    // 更新 Hero 潮位區塊
    this.updateInspectorHero(port);

    // 繪製 24 小時天文潮位曲線圖
    this.renderTideCurveSvg(port);

    // 渲染本日潮汐預報表格 (4 極值)
    this.renderTidesTable(port);

    // 航海與泊靠安全評估
    const advisoryEl = document.getElementById("nautical-advisory-content");
    if (advisoryEl) {
      const calc = this.calculateRealtimeTide(port);
      const safeDepth = (port.depthAvg + calc.level / 100).toFixed(2);
      advisoryEl.innerHTML = `
        <div style="margin-bottom: 6px;"><strong>港灣水深餘裕：</strong>設計平均水深約 <strong>${port.depthAvg} 公尺</strong>。當前潮位下口門安全水深約 <strong>${safeDepth} 公尺</strong>。</div>
        <div>${port.nauticalNote}</div>
      `;
    }

    // 氣象署官網連結
    const cwaBtn = document.getElementById("cwa-direct-link");
    if (cwaBtn) {
      cwaBtn.onclick = (e) => {
        e.preventDefault();
        this.openCwaModal(port);
      };
    }
  }

  updateInspectorHero(port) {
    const tideCalc = this.calculateRealtimeTide(port);
    const levelSign = tideCalc.level > 0 ? "+" : "";

    const numEl = document.getElementById("hero-number");
    const trendEl = document.getElementById("hero-trend-badge");
    const subinfoEl = document.getElementById("hero-subinfo");

    if (numEl) numEl.textContent = `${levelSign}${tideCalc.level}`;
    if (trendEl) {
      trendEl.className = `hero-trend-badge ${tideCalc.trendClass}`;
      trendEl.innerHTML = `${tideCalc.trendIcon} ${tideCalc.trendText}`;
    }
    if (subinfoEl) {
      subinfoEl.innerHTML = `距下次${tideCalc.nextTide.type} (<strong>${tideCalc.nextTide.timeStr}</strong>) 尚餘 <strong>${tideCalc.countdownStr}</strong>`;
    }
  }

  /* -------------------------------------------------------------
     6. 24 小時天文潮位平滑曲線圖 (SVG Renderer with Current Time Cursor)
     ------------------------------------------------------------- */
  renderTideCurveSvg(port) {
    const svg = document.getElementById("tide-curve-svg");
    if (!svg) return;

    const width = 350;
    const height = 135;
    const padding = { top: 22, right: 20, bottom: 26, left: 35 };

    const points = [];
    let minLvl = Infinity;
    let maxLvl = -Infinity;

    for (let m = 0; m <= 1440; m += 15) {
      const sampleDate = new Date(this.now);
      sampleDate.setHours(Math.floor(m / 60), m % 60, 0, 0);
      const calc = this.calculateRealtimeTide(port, sampleDate);
      points.push({ minutes: m, level: calc.level });
      if (calc.level < minLvl) minLvl = calc.level;
      if (calc.level > maxLvl) maxLvl = calc.level;
    }

    const lvlRange = maxLvl - minLvl || 1;
    const plotMin = minLvl - lvlRange * 0.15;
    const plotMax = maxLvl + lvlRange * 0.15;

    const getX = (m) => padding.left + (m / 1440) * (width - padding.left - padding.right);
    const getY = (lvl) => height - padding.bottom - ((lvl - plotMin) / (plotMax - plotMin)) * (height - padding.top - padding.bottom);

    let pathD = `M ${getX(points[0].minutes)} ${getY(points[0].level)}`;
    for (let i = 1; i < points.length; i++) {
      pathD += ` L ${getX(points[i].minutes)} ${getY(points[i].level)}`;
    }

    const fillPathD = `${pathD} L ${getX(1440)} ${height - padding.bottom} L ${getX(0)} ${height - padding.bottom} Z`;

    const currentM = this.now.getHours() * 60 + this.now.getMinutes() + this.now.getSeconds() / 60;
    const currentX = getX(currentM);
    const currentY = getY(this.calculateRealtimeTide(port).level);

    const extremaMarks = port.tides.map((t) => {
      const [h, min] = t.time.split(":").map(Number);
      const m = h * 60 + min;
      const x = getX(m);
      const y = getY(t[this.currentDatum]);
      const isHigh = t.type === "滿潮";
      return `
        <circle cx="${x}" cy="${y}" r="3.5" fill="${isHigh ? '#38bdf8' : '#f97316'}" stroke="#fff" stroke-width="1.5" />
        <text x="${x}" y="${isHigh ? y - 8 : y + 14}" font-size="9" fill="${isHigh ? '#7dd3fc' : '#fdba74'}" text-anchor="middle" font-weight="600">${t.type} ${t[this.currentDatum]}</text>
      `;
    }).join("");

    svg.innerHTML = `
      <defs>
        <linearGradient id="tideWaveGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#0284c7" stop-opacity="0.5" />
          <stop offset="100%" stop-color="#0284c7" stop-opacity="0.0" />
        </linearGradient>
      </defs>

      <!-- 網格基準線 -->
      <line x1="${padding.left}" y1="${getY(0)}" x2="${width - padding.right}" y2="${getY(0)}" stroke="rgba(255,255,255,0.15)" stroke-dasharray="3,3" />
      <text x="${padding.left - 5}" y="${getY(0) + 3}" fill="#64748b" font-size="8" text-anchor="end">0</text>

      <!-- 波形填充與線條 -->
      <path d="${fillPathD}" fill="url(#tideWaveGradient)" />
      <path d="${pathD}" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" />

      <!-- 滿乾潮標記 -->
      ${extremaMarks}

      <!-- 當前時間垂直指示線 -->
      <line x1="${currentX}" y1="${padding.top}" x2="${currentX}" y2="${height - padding.bottom}" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="2,2" />
      <circle cx="${currentX}" cy="${currentY}" r="5" fill="#ef4444" stroke="#ffffff" stroke-width="2">
        <animate attributeName="r" values="4;6.5;4" dur="1.8s" repeatCount="indefinite" />
      </circle>
      <text x="${currentX}" y="${padding.top - 5}" font-size="9" font-weight="bold" fill="#f87171" text-anchor="middle">現在</text>

      <!-- 時間橫軸刻度 -->
      <text x="${getX(0)}" y="${height - 8}" font-size="9" fill="#94a3b8" text-anchor="start">00:00</text>
      <text x="${getX(360)}" y="${height - 8}" font-size="9" fill="#64748b" text-anchor="middle">06:00</text>
      <text x="${getX(720)}" y="${height - 8}" font-size="9" fill="#94a3b8" text-anchor="middle">12:00</text>
      <text x="${getX(1080)}" y="${height - 8}" font-size="9" fill="#64748b" text-anchor="middle">18:00</text>
      <text x="${getX(1440)}" y="${height - 8}" font-size="9" fill="#94a3b8" text-anchor="end">24:00</text>
    `;
  }

  /* -------------------------------------------------------------
     7. 本日 4 次潮位極值詳細表格
     ------------------------------------------------------------- */
  renderTidesTable(port) {
    const tbody = document.getElementById("tides-table-body");
    if (!tbody) return;

    tbody.innerHTML = "";

    port.tides.forEach((t) => {
      const tr = document.createElement("tr");
      const isHigh = t.type === "滿潮";
      const typeClass = isHigh ? "cell-high-tide" : "cell-low-tide";

      tr.innerHTML = `
        <td class="${typeClass}">${t.type}</td>
        <td><strong>${t.time}</strong></td>
        <td>${t.chart_datum > 0 ? "+" : ""}${t.chart_datum}</td>
        <td>${t.twvd > 0 ? "+" : ""}${t.twvd}</td>
        <td>${t.msl > 0 ? "+" : ""}${t.msl}</td>
      `;

      tbody.appendChild(tr);
    });
  }

  /* -------------------------------------------------------------
     8. 基準面切換與商港切換
     ------------------------------------------------------------- */
  setDatum(datum) {
    this.currentDatum = datum;

    document.querySelectorAll(".datum-btn-group .ctrl-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.datum === datum);
    });

    this.renderMapMarkers();
    this.renderPortsList();
    this.renderBottomPills();

    const selectedPort = TIDE_PORTS_DATA.find((p) => p.id === this.selectedPortId);
    if (selectedPort) {
      this.renderInspectorDrawer(selectedPort);
    }
  }

  setPortFilter(portId) {
    this.currentPortFilter = portId;

    document.querySelectorAll(".filter-btn-group .ctrl-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.port === portId);
    });

    if (portId === "all") {
      this.map.flyTo([23.95, 121.0], 7.8, {
        duration: 1.2
      });
    } else {
      this.selectPort(portId, true);
    }
  }

  /* -------------------------------------------------------------
     10. CWA 30天預報彈窗 (In-App Modal)
     ------------------------------------------------------------- */
  openCwaModal(port) {
    const modal = document.getElementById("cwa-modal-backdrop");
    const title = document.getElementById("cwa-modal-title");
    const frame = document.getElementById("cwa-modal-iframe");
    if (!modal || !frame) return;

    title.innerHTML = `交通部中央氣象署 - ${port.fullName} 未來 30 天潮汐預報表`;
    frame.src = port.cwaUrl;
    modal.classList.add("open");
  }

  closeCwaModal() {
    const modal = document.getElementById("cwa-modal-backdrop");
    const frame = document.getElementById("cwa-modal-iframe");
    if (!modal) return;

    modal.classList.remove("open");
    if (frame) frame.src = "about:blank";
  }

  /* -------------------------------------------------------------
     11. 事件監聽綁定
     ------------------------------------------------------------- */
  initEventListeners() {
    // 基準面按鈕
    document.querySelectorAll(".datum-btn-group .ctrl-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.setDatum(btn.dataset.datum);
      });
    });

    // 五大商港快速按鈕
    document.querySelectorAll(".filter-btn-group .ctrl-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.setPortFilter(btn.dataset.port);
      });
    });

    // 側邊欄收合切換
    const toggleSidebarBtn = document.getElementById("sidebar-toggle-btn");
    const leftSidebar = document.getElementById("map-overlay-left");
    if (toggleSidebarBtn && leftSidebar) {
      toggleSidebarBtn.addEventListener("click", () => {
        leftSidebar.classList.toggle("collapsed");
        toggleSidebarBtn.innerHTML = leftSidebar.classList.contains("collapsed") ? "☰" : "◀";
      });
    }

    // 右側抽屜關閉
    const closeInspectorBtn = document.getElementById("inspector-close-btn");
    const rightInspector = document.getElementById("map-overlay-right");
    if (closeInspectorBtn && rightInspector) {
      closeInspectorBtn.addEventListener("click", () => {
        rightInspector.classList.add("hidden");
      });
    }

    // 搜尋輸入框
    const searchInput = document.getElementById("port-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        this.searchQuery = e.target.value.trim();
        this.renderPortsList();
      });
    }

    // CWA 彈窗關閉
    const modalCloseBtn = document.getElementById("modal-close-btn");
    const modalBackdrop = document.getElementById("cwa-modal-backdrop");
    if (modalCloseBtn) {
      modalCloseBtn.addEventListener("click", () => this.closeCwaModal());
    }
    if (modalBackdrop) {
      modalBackdrop.addEventListener("click", (e) => {
        if (e.target === modalBackdrop) this.closeCwaModal();
      });
    }

    // 船難海污模擬開關按鈕
    const spillToggleBtn = document.getElementById("btn-spill-toggle");
    if (spillToggleBtn) {
      spillToggleBtn.addEventListener("click", () => {
        this.toggleSpillPanel();
      });
    }

    // 關閉海污模擬面板
    const spillCloseBtn = document.getElementById("btn-spill-close");
    if (spillCloseBtn) {
      spillCloseBtn.addEventListener("click", () => {
        this.closeSpillPanel();
      });
    }

    // 最小化/展開海污面板
    const spillMinimizeBtn = document.getElementById("btn-spill-minimize");
    if (spillMinimizeBtn) {
      spillMinimizeBtn.addEventListener("click", () => {
        this.toggleSpillMinimize();
      });
    }

    // 自訂地圖沉船位置按鈕
    const customPinBtn = document.getElementById("btn-custom-pin");
    if (customPinBtn) {
      customPinBtn.addEventListener("click", () => {
        this.enableCustomPinDrop();
      });
    }

    // 原油外洩規模按鈕
    document.querySelectorAll(".spill-vol-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.setSpillVolume(Number(btn.dataset.volume));
      });
    });

    // 時間軸滑桿 (0-72小時)
    const hoursSlider = document.getElementById("spill-hours-slider");
    if (hoursSlider) {
      hoursSlider.addEventListener("input", (e) => {
        this.stopSpillPlay();
        this.setSpillHours(Number(e.target.value));
      });
    }

    // 動畫播放 / 暫停按鈕
    const spillPlayBtn = document.getElementById("btn-spill-play");
    if (spillPlayBtn) {
      spillPlayBtn.addEventListener("click", () => {
        this.toggleSpillPlay();
      });
    }

    // 重置按鈕
    const spillResetBtn = document.getElementById("btn-spill-reset");
    if (spillResetBtn) {
      spillResetBtn.addEventListener("click", () => {
        this.resetSpillHours();
      });
    }
  }

  /* -------------------------------------------------------------
     12. 近海船難原油外洩污染擴散模擬系統 (Oil Spill Simulation Engine)
     ------------------------------------------------------------- */
  initSpillSimulation() {
    this.initCoastlineData();

    // 依使用者指示：左邊一開始的欄位改成船難海污模擬先啟動
    this.spillSim.isOpen = true;
    this.spillSim.isDroppingPin = true;

    const panel = document.getElementById("spill-panel");
    const toggleBtn = document.getElementById("btn-spill-toggle");
    const leftSidebar = document.getElementById("map-overlay-left");
    const toggleSidebarBtn = document.getElementById("sidebar-toggle-btn");
    const rightInspector = document.getElementById("map-overlay-right");

    if (panel) {
      panel.style.display = "flex";
    }
    if (toggleBtn) {
      toggleBtn.classList.add("active");
    }
    // 左側欄位優先由船難海污模擬系統啟動，隱藏商港側欄與折疊按鈕
    if (leftSidebar) {
      leftSidebar.classList.add("hidden");
    }
    if (toggleSidebarBtn) {
      toggleSidebarBtn.classList.add("hidden");
    }
    // 右側抽屜初始隱藏保持全景視野
    if (rightInspector) {
      rightInspector.classList.add("hidden");
    }

    const mapEl = document.getElementById("map");
    if (mapEl) {
      mapEl.classList.add("map-pin-drop-mode");
    }

    const pinBtn = document.getElementById("btn-custom-pin");
    if (pinBtn) pinBtn.classList.add("active");

    const statusTag = document.getElementById("pin-status-tag");
    if (statusTag) statusTag.textContent = "● 點選模式常駐中";

    const incidentCoordsEl = document.getElementById("spill-incident-coords");
    if (incidentCoordsEl) {
      incidentCoordsEl.textContent = `📍 當前沉沒座標：${this.spillSim.origin[0].toFixed(4)}°N, ${this.spillSim.origin[1].toFixed(4)}°E ｜ 提示：直接點擊海面或輸入精確座標均可定位！`;
    }

    // 初始化經緯度座標輸入欄位與事件綁定
    const inputLat = document.getElementById("input-spill-lat");
    const inputLng = document.getElementById("input-spill-lng");
    const btnCoordsApply = document.getElementById("btn-coords-apply");

    if (inputLat) inputLat.value = this.spillSim.origin[0].toFixed(4);
    if (inputLng) inputLng.value = this.spillSim.origin[1].toFixed(4);

    const handleApplyCoords = () => {
      const latVal = parseFloat(inputLat ? inputLat.value : NaN);
      const lngVal = parseFloat(inputLng ? inputLng.value : NaN);
      if (isNaN(latVal) || isNaN(lngVal)) {
        alert("請輸入有效的緯度與經度數值！");
        return;
      }
      if (latVal < 18.0 || latVal > 29.0 || lngVal < 115.0 || lngVal > 126.0) {
        alert("輸入座標超出臺灣周邊海域合理範圍 (緯度 18°N~29°N，經度 115°E~126°E)，請重新輸入！");
        return;
      }
      this.setSpillCoordinates(latVal, lngVal, true, true);
    };

    if (btnCoordsApply) {
      btnCoordsApply.onclick = handleApplyCoords;
    }
    if (inputLat) {
      inputLat.onkeydown = (e) => {
        if (e.key === "Enter") handleApplyCoords();
      };
    }
    if (inputLng) {
      inputLng.onkeydown = (e) => {
        if (e.key === "Enter") handleApplyCoords();
      };
    }

    this.updateSpillSimulation();
  }

  toggleSpillPanel(forceState) {
    const panel = document.getElementById("spill-panel");
    const toggleBtn = document.getElementById("btn-spill-toggle");
    const leftSidebar = document.getElementById("map-overlay-left");
    const toggleSidebarBtn = document.getElementById("sidebar-toggle-btn");
    if (!panel || !toggleBtn) return;

    const nextState = forceState !== undefined ? forceState : !this.spillSim.isOpen;
    this.spillSim.isOpen = nextState;

    if (this.spillSim.isOpen) {
      panel.style.display = "flex";
      toggleBtn.classList.add("active");

      // 左側空間優先讓給船難海污模擬系統
      if (leftSidebar) leftSidebar.classList.add("hidden");
      if (toggleSidebarBtn) toggleSidebarBtn.classList.add("hidden");

      // 常駐啟用海面點選沉船模式
      this.spillSim.isDroppingPin = true;
      const mapEl = document.getElementById("map");
      if (mapEl) mapEl.classList.add("map-pin-drop-mode");

      const pinBtn = document.getElementById("btn-custom-pin");
      if (pinBtn) pinBtn.classList.add("active");

      const statusTag = document.getElementById("pin-status-tag");
      if (statusTag) statusTag.textContent = "● 點選模式常駐中";

      this.updateSpillSimulation();
      this.map.flyTo(this.spillSim.origin, 9.5, { duration: 1.0 });
    } else {
      panel.style.display = "none";
      toggleBtn.classList.remove("active");
      this.stopSpillPlay();
      this.clearSpillGraphics();
      this.spillSim.isDroppingPin = false;
      const mapEl = document.getElementById("map");
      if (mapEl) mapEl.classList.remove("map-pin-drop-mode");

      // 當關閉海污模擬時，恢復左側商港清單欄位
      if (leftSidebar) leftSidebar.classList.remove("hidden");
      if (toggleSidebarBtn) toggleSidebarBtn.classList.remove("hidden");
    }
  }

  closeSpillPanel() {
    this.toggleSpillPanel(false);
  }

  toggleSpillMinimize() {
    const panel = document.getElementById("spill-panel");
    const btn = document.getElementById("btn-spill-minimize");
    if (!panel || !btn) return;

    this.spillSim.isMinimized = !this.spillSim.isMinimized;
    if (this.spillSim.isMinimized) {
      panel.classList.add("minimized");
      btn.textContent = "▢";
      btn.title = "展開面板";
    } else {
      panel.classList.remove("minimized");
      btn.textContent = "_";
      btn.title = "最小化面板";
    }
  }

  enableCustomPinDrop() {
    this.spillSim.isDroppingPin = true;
    const mapEl = document.getElementById("map");
    if (mapEl) mapEl.classList.add("map-pin-drop-mode");

    const pinBtn = document.getElementById("btn-custom-pin");
    if (pinBtn) pinBtn.classList.add("active");

    const statusTag = document.getElementById("pin-status-tag");
    if (statusTag) statusTag.textContent = "● 點選模式常駐中";

    const incidentCoordsEl = document.getElementById("spill-incident-coords");
    if (incidentCoordsEl) {
      incidentCoordsEl.textContent = "🎯 點選模式常駐中：請直接點擊地圖任意海面，即時設置沉船事故點！";
    }
  }

  setSpillCoordinates(lat, lng, flyTo = true, isManualInput = false) {
    this.spillSim.isDroppingPin = true;
    const mapEl = document.getElementById("map");
    if (mapEl) mapEl.classList.add("map-pin-drop-mode");

    let finalLat = Number(lat);
    let finalLng = Number(lng);
    let wasAdjusted = false;

    // 檢查點擊或輸入之座標是否位於陸域
    if (this.isPointOnLand(finalLng, finalLat)) {
      wasAdjusted = true;
      let bestDist = Infinity;
      let bestSeg = this.coastSegments && this.coastSegments.length > 0 ? this.coastSegments[0] : null;
      if (this.coastSegments) {
        for (let i = 0; i < this.coastSegments.length; i++) {
          const s = this.coastSegments[i];
          const mx = (s.p1[0] + s.p2[0]) / 2;
          const my = (s.p1[1] + s.p2[1]) / 2;
          const d = (mx - finalLng) ** 2 + (my - finalLat) ** 2;
          if (d < bestDist) {
            bestDist = d;
            bestSeg = s;
          }
        }
      }
      if (bestSeg) {
        const coastLng = (bestSeg.p1[0] + bestSeg.p2[0]) / 2;
        const coastLat = (bestSeg.p1[1] + bestSeg.p2[1]) / 2;
        const dLng = finalLng - 120.95;
        const dLat = finalLat - 23.75;
        const dLen = Math.sqrt(dLng * dLng + dLat * dLat) || 1;
        finalLng = coastLng + (dLng / dLen) * 0.04;
        finalLat = coastLat + (dLat / dLen) * 0.04;
      }
    }

    this.spillSim.origin = [finalLat, finalLng];
    this.spillSim.preset = "custom";
    this.spillSim.shipName = "自訂近海遇險船舶";
    this.spillSim.cargoDesc = "假設此海域發生船難進水沉沒，油料破裂外洩";

    // 同步更新經緯度手動輸入欄位
    const inputLat = document.getElementById("input-spill-lat");
    const inputLng = document.getElementById("input-spill-lng");
    if (inputLat) inputLat.value = finalLat.toFixed(4);
    if (inputLng) inputLng.value = finalLng.toFixed(4);

    const pinBtn = document.getElementById("btn-custom-pin");
    if (pinBtn) pinBtn.classList.add("active");

    const statusTag = document.getElementById("pin-status-tag");
    if (statusTag) statusTag.textContent = "● 點選模式常駐中";

    const incidentCoordsEl = document.getElementById("spill-incident-coords");
    if (incidentCoordsEl) {
      if (wasAdjusted) {
        incidentCoordsEl.textContent = `⚠️ 所設座標落於陸地！系統已自動修正至鄰近外海 (${finalLat.toFixed(4)}°N, ${finalLng.toFixed(4)}°E) 並展開推演。`;
      } else {
        const sourceText = isManualInput ? "手動座標輸入" : "地圖點選";
        incidentCoordsEl.textContent = `📍 沉沒座標 [${sourceText}]：${finalLat.toFixed(4)}°N, ${finalLng.toFixed(4)}°E ｜ 提示：直接點擊海面或輸入座標可隨時變更！`;
      }
    }

    this.updateSpillSimulation();

    if (flyTo) {
      this.map.flyTo([finalLat, finalLng], 9.5, { duration: 1.0 });
    }
  }

  handleMapClickForPinDrop(latlng) {
    this.setSpillCoordinates(latlng.lat, latlng.lng, false, false);
  }

  setSpillVolume(volumeTons) {
    this.spillSim.volume = volumeTons;
    document.querySelectorAll(".spill-vol-btn").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.volume) === volumeTons);
    });
    this.updateSpillSimulation();
  }

  setSpillHours(hours) {
    this.spillSim.hours = Math.max(1, Math.min(72, hours));
    const hoursDisplay = document.getElementById("spill-hours-display");
    if (hoursDisplay) hoursDisplay.textContent = `${this.spillSim.hours} 小時`;

    const slider = document.getElementById("spill-hours-slider");
    if (slider && Number(slider.value) !== this.spillSim.hours) {
      slider.value = this.spillSim.hours;
    }

    this.updateSpillSimulation();
  }

  toggleSpillPlay() {
    if (this.spillSim.isPlaying) {
      this.stopSpillPlay();
    } else {
      this.startSpillPlay();
    }
  }

  startSpillPlay() {
    this.spillSim.isPlaying = true;
    const playBtn = document.getElementById("btn-spill-play");
    if (playBtn) {
      playBtn.textContent = "⏸ 暫停推演";
      playBtn.classList.add("playing");
    }

    if (this.spillSim.playTimer) clearInterval(this.spillSim.playTimer);
    this.spillSim.playTimer = setInterval(() => {
      let nextHours = this.spillSim.hours + 1;
      if (nextHours > 72) {
        nextHours = 1;
      }
      this.setSpillHours(nextHours);
    }, 450);
  }

  stopSpillPlay() {
    this.spillSim.isPlaying = false;
    if (this.spillSim.playTimer) {
      clearInterval(this.spillSim.playTimer);
      this.spillSim.playTimer = null;
    }
    const playBtn = document.getElementById("btn-spill-play");
    if (playBtn) {
      playBtn.textContent = "▶ 播放擴散";
      playBtn.classList.remove("playing");
    }
  }

  resetSpillHours() {
    this.stopSpillPlay();
    this.setSpillHours(1);
  }

  clearSpillGraphics() {
    if (this.spillLayerGroup) {
      this.spillLayerGroup.clearLayers();
    }
  }

  /**
   * 計算兩經緯度之間的大圓海浬距離 (Haversine Formula)
   */
  getHaversineDistanceNm(lat1, lon1, lat2, lon2) {
    const R = 3440.065; // 地球半徑 (海浬)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * 初始化臺灣海岸線地理邊界數據 (從 TAIWAN_GEOJSON 萃取 338 條真實海岸線區段)
   */
  initCoastlineData() {
    this.coastSegments = [];
    if (typeof TAIWAN_GEOJSON === "undefined" || !TAIWAN_GEOJSON.features) return;

    const rawEdges = [];
    TAIWAN_GEOJSON.features.forEach((feature) => {
      const county = feature.properties.name_zh || feature.properties.name || "臺灣沿岸";
      const geom = feature.geometry;
      if (!geom) return;
      const rings = [];
      if (geom.type === "MultiPolygon") {
        geom.coordinates.forEach((poly) => poly.forEach((ring) => rings.push(ring)));
      } else if (geom.type === "Polygon") {
        geom.coordinates.forEach((ring) => rings.push(ring));
      }

      rings.forEach((ring) => {
        for (let i = 0; i < ring.length - 1; i++) {
          const p1 = [Math.round(ring[i][0] * 100000) / 100000, Math.round(ring[i][1] * 100000) / 100000];
          const p2 = [Math.round(ring[i + 1][0] * 100000) / 100000, Math.round(ring[i + 1][1] * 100000) / 100000];
          rawEdges.push({ p1, p2, county });
        }
      });
    });

    // 計算無向邊出現次數：只出現 1 次者為外圍海岸線邊界
    const edgeCounts = new Map();
    rawEdges.forEach((edge) => {
      const k1 = `${edge.p1[0]},${edge.p1[1]}_${edge.p2[0]},${edge.p2[1]}`;
      const k2 = `${edge.p2[0]},${edge.p2[1]}_${edge.p1[0]},${edge.p1[1]}`;
      const sortedKey = k1 < k2 ? k1 : k2;
      edgeCounts.set(sortedKey, (edgeCounts.get(sortedKey) || 0) + 1);
    });

    rawEdges.forEach((edge) => {
      const k1 = `${edge.p1[0]},${edge.p1[1]}_${edge.p2[0]},${edge.p2[1]}`;
      const k2 = `${edge.p2[0]},${edge.p2[1]}_${edge.p1[0]},${edge.p1[1]}`;
      const sortedKey = k1 < k2 ? k1 : k2;
      if (edgeCounts.get(sortedKey) === 1) {
        const minX = Math.min(edge.p1[0], edge.p2[0]);
        const maxX = Math.max(edge.p1[0], edge.p2[0]);
        const minY = Math.min(edge.p1[1], edge.p2[1]);
        const maxY = Math.max(edge.p1[1], edge.p2[1]);
        const lenKm = this.getHaversineDistanceNm(edge.p1[1], edge.p1[0], edge.p2[1], edge.p2[0]) * 1.852;
        this.coastSegments.push({
          p1: edge.p1, // [lng, lat]
          p2: edge.p2,
          county: edge.county,
          minX,
          maxX,
          minY,
          maxY,
          lenKm
        });
      }
    });
  }

  /**
   * 判定座標是否位於臺灣陸地內部 (Point-in-Polygon 射線交叉檢驗)
   */
  isPointOnLand(lng, lat) {
    if (lng < 119.8 || lng > 122.2 || lat < 21.7 || lat > 25.5) return false;
    if (typeof TAIWAN_GEOJSON === "undefined" || !TAIWAN_GEOJSON.features) return false;

    const pointInRing = (x, y, ring) => {
      let inside = false;
      const n = ring.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };

    for (let f = 0; f < TAIWAN_GEOJSON.features.length; f++) {
      const geom = TAIWAN_GEOJSON.features[f].geometry;
      if (!geom) continue;
      if (geom.type === "MultiPolygon") {
        for (let p = 0; p < geom.coordinates.length; p++) {
          if (pointInRing(lng, lat, geom.coordinates[p][0])) return true;
        }
      } else if (geom.type === "Polygon") {
        if (pointInRing(lng, lat, geom.coordinates[0])) return true;
      }
    }
    return false;
  }

  /**
   * 計算兩線段之幾何交點 (Segment-Segment Intersection)
   */
  getLineIntersection(p1, p2, p3, p4) {
    const x1 = p1[0], y1 = p1[1];
    const x2 = p2[0], y2 = p2[1];
    const x3 = p3[0], y3 = p3[1];
    const x4 = p4[0], y4 = p4[1];

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-12) return null;

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

    if (t >= 0.0 && t <= 1.0 && u >= 0.0 && u <= 1.0) {
      return {
        t,
        x: x1 + t * (x2 - x1),
        y: y1 + t * (y2 - y1)
      };
    }
    return null;
  }

  /**
   * 將擴散射線約束裁切於海岸線（遇海岸邊停止，絕不流入陸地）
   */
  clampRayToCoast(centerLng, centerLat, targetLng, targetLat) {
    if (!this.coastSegments || this.coastSegments.length === 0) {
      return { hit: false, lat: targetLat, lng: targetLng, segment: null };
    }

    const rMinX = Math.min(centerLng, targetLng);
    const rMaxX = Math.max(centerLng, targetLng);
    const rMinY = Math.min(centerLat, targetLat);
    const rMaxY = Math.max(centerLat, targetLat);

    let minT = 1.0;
    let hitRes = null;
    let hitSeg = null;

    for (let i = 0; i < this.coastSegments.length; i++) {
      const seg = this.coastSegments[i];
      if (rMaxX < seg.minX || rMinX > seg.maxX || rMaxY < seg.minY || rMinY > seg.maxY) {
        continue;
      }
      const res = this.getLineIntersection([centerLng, centerLat], [targetLng, targetLat], seg.p1, seg.p2);
      if (res && res.t < minT) {
        minT = res.t;
        hitRes = res;
        hitSeg = seg;
      }
    }

    if (hitRes && hitSeg) {
      // 遇岸阻絕！回退 60 公尺 (0.0006度) 緊貼海岸線海側，禁止覆蓋陸地
      const dLng = centerLng - hitRes.x;
      const dLat = centerLat - hitRes.y;
      const dLen = Math.sqrt(dLng * dLng + dLat * dLat) || 1;
      const safeLng = hitRes.x + (dLng / dLen) * 0.0006;
      const safeLat = hitRes.y + (dLat / dLen) * 0.0006;
      return {
        hit: true,
        lat: safeLat,
        lng: safeLng,
        segment: hitSeg,
        t: minT
      };
    }

    // 若射線未直接相交但目標頂點已落於陸地（如角隅地形）
    if (this.isPointOnLand(targetLng, targetLat)) {
      let bestDist = Infinity;
      let bestPt = [centerLng, centerLat];
      let bestSeg = this.coastSegments[0];
      for (let i = 0; i < this.coastSegments.length; i++) {
        const seg = this.coastSegments[i];
        const midX = (seg.p1[0] + seg.p2[0]) / 2;
        const midY = (seg.p1[1] + seg.p2[1]) / 2;
        const d = (midX - targetLng) ** 2 + (midY - targetLat) ** 2;
        if (d < bestDist) {
          bestDist = d;
          bestPt = [midX, midY];
          bestSeg = seg;
        }
      }
      const dLng = centerLng - bestPt[0];
      const dLat = centerLat - bestPt[1];
      const dLen = Math.sqrt(dLng * dLng + dLat * dLat) || 1;
      return {
        hit: true,
        lat: bestPt[1] + (dLat / dLen) * 0.0006,
        lng: bestPt[0] + (dLng / dLen) * 0.0006,
        segment: bestSeg,
        t: 0.95
      };
    }

    return { hit: false, lat: targetLat, lng: targetLng, segment: null };
  }

  /**
   * 漂移中心遇海岸線阻絕限制（海難漂移中心停滯於岸外海面，不得漂上陸地）
   */
  clampCenterToCoast(originLng, originLat, centerLng, centerLat) {
    if (!this.coastSegments || this.coastSegments.length === 0) {
      return [centerLat, centerLng];
    }
    const rMinX = Math.min(originLng, centerLng);
    const rMaxX = Math.max(originLng, centerLng);
    const rMinY = Math.min(originLat, centerLat);
    const rMaxY = Math.max(originLat, centerLat);

    let minT = 1.0;
    let hitRes = null;

    for (let i = 0; i < this.coastSegments.length; i++) {
      const seg = this.coastSegments[i];
      if (rMaxX < seg.minX || rMinX > seg.maxX || rMaxY < seg.minY || rMinY > seg.maxY) {
        continue;
      }
      const res = this.getLineIntersection([originLng, originLat], [centerLng, centerLat], seg.p1, seg.p2);
      if (res && res.t < minT) {
        minT = res.t;
        hitRes = res;
      }
    }

    if (hitRes) {
      // 漂移中心逼近海岸時，停止於岸外約 350 公尺海面
      const dLng = originLng - hitRes.x;
      const dLat = originLat - hitRes.y;
      const dLen = Math.sqrt(dLng * dLng + dLat * dLat) || 1;
      const safeLng = hitRes.x + (dLng / dLen) * 0.0035;
      const safeLat = hitRes.y + (dLat / dLen) * 0.0035;
      return [safeLat, safeLng];
    }

    if (this.isPointOnLand(centerLng, centerLat)) {
      return [originLat, originLng];
    }

    return [centerLat, centerLng];
  }

  /**
   * 生成經海岸線嚴格物理阻絕裁切之油膜擴散多邊形座標（72道射線貼齊海岸線，零陸地滲漏）
   */
  generateClippedSlickPolygon(centerLat, centerLng, majorKm, minorKm, angleDeg, noiseSeed = 0) {
    const pts = [];
    const count = 72; // 每 5 度一條射線，高解析度海岸線貼齊
    const rad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);
    const kmPerLat = 111.0;
    const kmPerLng = 111.0 * Math.cos((centerLat * Math.PI) / 180);

    let hitCount = 0;
    const touchedSegments = [];

    for (let i = 0; i < count; i++) {
      const theta = (i / count) * 2 * Math.PI;
      const wave = 1 + 0.05 * Math.sin(3 * theta + noiseSeed) + 0.025 * Math.cos(5 * theta - noiseSeed);
      const x = (majorKm / 2) * Math.cos(theta) * wave;
      const y = (minorKm / 2) * Math.sin(theta) * wave;

      const rotX = x * cosA - y * sinA;
      const rotY = x * sinA + y * cosA;

      const targetLat = centerLat + (rotY / kmPerLat);
      const targetLng = centerLng + (rotX / kmPerLng);

      const clampRes = this.clampRayToCoast(centerLng, centerLat, targetLng, targetLat);
      pts.push([clampRes.lat, clampRes.lng]);

      if (clampRes.hit) {
        hitCount++;
        if (clampRes.segment && !touchedSegments.includes(clampRes.segment)) {
          touchedSegments.push(clampRes.segment);
        }
      }
    }

    return {
      pts,
      hitCount,
      touchedSegments
    };
  }

  /**
   * 依事故座標與實時潮汐推算當前海域海流現況 (流向、流速、水文系統、機制)
   */
  calculateSeaCurrent(originLat, originLng, isRising, nearestPort) {
    let currentSystem = "臺灣沿岸潮流系統";
    let driftAngle = 35; // 方位角 0-360
    let driftSpeed = 1.4; // 節
    let compassText = "北北東 (NNE)";
    let dispersionHeading = "朝東北海域蔓延";
    let driftMechanism = "";

    const formatBearing = (deg) => {
      const d = (deg % 360 + 360) % 360;
      if (d >= 337.5 || d < 22.5) return "正北 (N)";
      if (d < 67.5) return "北北東 (NNE)";
      if (d < 112.5) return "正東 (E)";
      if (d < 157.5) return "東南 (SE)";
      if (d < 202.5) return "正南 (S)";
      if (d < 247.5) return "西南西 (WSW)";
      if (d < 292.5) return "正西 (W)";
      return "西北 (NW)";
    };

    if (nearestPort.id === "hualien" || (originLng > 121.5 && originLat < 24.8)) {
      currentSystem = "太平洋黑潮主流系統 (Kuroshio)";
      driftAngle = isRising ? 20 : 16;
      driftSpeed = isRising ? 2.3 : 1.8;
      compassText = formatBearing(driftAngle);
      dispersionHeading = "朝北北東太平洋外洋強勁擴散";
      driftMechanism = `黑潮常年強勁北向深海流 (~${isRising ? "2.3" : "1.8"} 節) ｜ ${isRising ? "氣象署即時漲潮加速推進" : "退潮期微幅減速但穩定北漂"}`;
    } else if (nearestPort.id === "taipei") {
      currentSystem = "臺灣海峽北部沿岸潮海流";
      if (isRising) {
        driftAngle = 35;
        driftSpeed = 1.5;
        compassText = formatBearing(driftAngle);
        dispersionHeading = "朝北北東淡水河口/富貴角外海延伸";
        driftMechanism = "氣象署推算實時漲潮中 ｜ 外海潮流湧入海峽北口，向北北東漂移 (~1.5 節)";
      } else {
        driftAngle = 215;
        driftSpeed = 1.3;
        compassText = formatBearing(driftAngle);
        dispersionHeading = "沿臺灣海峽向西南西桃園沿岸漂移";
        driftMechanism = "氣象署推算實時退潮中 ｜ 落潮流沿西北海峽向西南西漂移 (~1.3 節)";
      }
    } else if (nearestPort.id === "keelung") {
      currentSystem = "東北角陸棚潮流與黑潮支流交匯區";
      if (isRising) {
        driftAngle = 65;
        driftSpeed = 1.3;
        compassText = formatBearing(driftAngle);
        dispersionHeading = "朝東東北往太平洋開闊海面擴散";
        driftMechanism = "氣象署推算實時漲潮中 ｜ 東北向潮流導向外海 (~1.3 節)";
      } else {
        driftAngle = 240;
        driftSpeed = 1.0;
        compassText = formatBearing(driftAngle);
        dispersionHeading = "朝西南西逼近金山萬里/野柳沿岸";
        driftMechanism = "氣象署推算實時退潮中 ｜ 沿岸潮水迴旋向西南西逼近岸際 (~1.0 節)";
      }
    } else if (nearestPort.id === "taichung") {
      currentSystem = "臺灣海峽中段天文潮急流區";
      if (isRising) {
        driftAngle = 30;
        driftSpeed = 2.2;
        compassText = formatBearing(driftAngle);
        dispersionHeading = "沿海峽中段向北北東苗栗外海急流擴散";
        driftMechanism = "強烈漲潮流湧升 ｜ 臺灣海峽狹管急流向北北東暴衝 (~2.2 節)";
      } else {
        driftAngle = 210;
        driftSpeed = 1.9;
        compassText = formatBearing(driftAngle);
        dispersionHeading = "沿海峽中段向南南西彰化外海急流漂移";
        driftMechanism = "強烈退潮流排洩 ｜ 臺灣海峽落潮流向南南西急流漂移 (~1.9 節)";
      }
    } else if (nearestPort.id === "kaohsiung") {
      currentSystem = "臺灣西南海域黑潮支流與沿岸流";
      if (isRising) {
        driftAngle = 320;
        driftSpeed = 1.2;
        compassText = formatBearing(driftAngle);
        dispersionHeading = "朝西北沿岸往興達港/安平海域延伸";
        driftMechanism = "氣象署推算實時漲潮中 ｜ 西南海流順岸往西北推展 (~1.2 節)";
      } else {
        driftAngle = 140;
        driftSpeed = 1.0;
        compassText = formatBearing(driftAngle);
        dispersionHeading = "朝東南外海往小琉球海域漂移";
        driftMechanism = "氣象署推算實時退潮中 ｜ 潮水往東南開闊海面流動 (~1.0 節)";
      }
    } else {
      driftAngle = isRising ? 35 : 215;
      driftSpeed = 1.2;
      compassText = formatBearing(driftAngle);
      dispersionHeading = isRising ? "朝東北沿海漂移" : "朝西南沿海漂移";
      driftMechanism = isRising ? "實時漲潮流推展" : "實時退潮流退移";
    }

    return {
      currentSystem,
      driftAngle,
      driftSpeed,
      compassText,
      dispersionHeading,
      driftMechanism
    };
  }

  /**
   * 核心海污模擬推算與視覺化更新渲染 (依海流現況標示預估擴散範圍與方向)
   */
  updateSpillSimulation() {
    if (!this.spillSim.isOpen || !this.spillLayerGroup) return;

    this.spillLayerGroup.clearLayers();

    const [originLat, originLng] = this.spillSim.origin;
    const hours = this.spillSim.hours;
    const volume = this.spillSim.volume;

    // 1. 尋找距離事故點最近之商港
    let nearestPort = TIDE_PORTS_DATA[0];
    let minDistance = 999999;
    TIDE_PORTS_DATA.forEach((p) => {
      const d = this.getHaversineDistanceNm(originLat, originLng, p.coords[0], p.coords[1]);
      if (d < minDistance) {
        minDistance = d;
        nearestPort = p;
      }
    });

    // 2. 結合該商港當前之氣象署實時天文潮位狀態 (漲潮 / 退潮)
    const tideCalc = this.calculateRealtimeTide(nearestPort, this.now);
    const isRising = tideCalc.isRising;

    // 3. 台灣近海水文潮流與海流現況動態耦合
    const seaCurrent = this.calculateSeaCurrent(originLat, originLng, isRising, nearestPort);
    const driftAngle = seaCurrent.driftAngle;
    const driftSpeed = seaCurrent.driftSpeed;

    // 4. 計算在經過 hours 小時後的漂移中心點 (兼顧潮汐半日潮 12.42 小時週期性振盪與沿岸餘流)
    const residualSpeed = driftSpeed * 0.35;
    const tidalOsc = driftSpeed * 0.65;
    const tidalPhase = (2 * Math.PI * hours) / 12.42;
    const netDriftNm = (residualSpeed * hours) + (tidalOsc * 1.5 * Math.sin(tidalPhase / 2));
    const safeDriftNm = Math.max(0.15, netDriftNm);

    const rad = (driftAngle * Math.PI) / 180;
    const dLat = (safeDriftNm * Math.cos(rad)) / 60.0;
    const dLng = (safeDriftNm * Math.sin(rad)) / (60.0 * Math.cos(originLat * Math.PI / 180));
    const rawCenterLat = originLat + dLat;
    const rawCenterLng = originLng + dLng;

    // 關鍵！漂移中心遇到海岸邊必須停止於海面，不可飄流到陸地上
    const [centerLat, centerLng] = this.clampCenterToCoast(originLng, originLat, rawCenterLng, rawCenterLat);

    // 5. 菲氏擴散定律 (Fay's Spreading Law) 多層級油膜範圍尺寸推算
    const s_v = Math.pow(volume / 300, 0.333);

    // 重度核心區 (>1.0mm 瀝青焦油塊)
    const heavyMajorKm = (0.35 + 0.12 * Math.pow(hours, 0.52)) * s_v;
    const heavyMinorKm = (0.22 + 0.08 * Math.pow(hours, 0.45)) * s_v;
    const heavyAreaKm2 = Math.PI * (heavyMajorKm / 2) * (heavyMinorKm / 2);

    // 中度擴散帶 (0.1~1.0mm 乳化水包油混合帶)
    const modMajorKm = (0.90 + 0.35 * Math.pow(hours, 0.62)) * s_v;
    const modMinorKm = (0.55 + 0.20 * Math.pow(hours, 0.52)) * s_v;
    const modAreaKm2 = Math.PI * (modMajorKm / 2) * (modMinorKm / 2);

    // 輕度油光外圍 (<0.1mm 彩虹油膜前鋒)
    const sheenMajorKm = (2.0 + 0.68 * Math.pow(hours, 0.70)) * s_v;
    const sheenMinorKm = (1.3 + 0.40 * Math.pow(hours, 0.60)) * s_v;
    const sheenAreaKm2 = Math.PI * (sheenMajorKm / 2) * (sheenMinorKm / 2);

    // 最遠漂移半徑 (海浬)
    const maxRadiusNm = safeDriftNm + (sheenMajorKm / 2) / 1.852;

    // 6. 距離最近商港之威脅警戒評估
    const distToNearestPort = this.getHaversineDistanceNm(centerLat, centerLng, nearestPort.coords[0], nearestPort.coords[1]);
    let threatLevel = "港外安全";
    if (distToNearestPort < 3.0) {
      threatLevel = "🚨 極度高危！油膜直逼商港主航道";
    } else if (distToNearestPort < 6.0) {
      threatLevel = "⚠️ 高度警戒！逼近商港防波堤外海";
    } else {
      threatLevel = "中度警戒 (港外監控戒備)";
    }

    // 生成經海岸線物理阻絕裁切之油膜多邊形 (不可預估流到陸地上)
    const sheenData = this.generateClippedSlickPolygon(centerLat, centerLng, sheenMajorKm, sheenMinorKm, driftAngle, 1.2);
    const modData = this.generateClippedSlickPolygon(centerLat, centerLng, modMajorKm, modMinorKm, driftAngle, 2.5);
    const heavyData = this.generateClippedSlickPolygon(centerLat, centerLng, heavyMajorKm, heavyMinorKm, driftAngle, 3.8);

    // 遇到海岸邊要停止並開始累計汙染物 (海岸線阻截與油污累積推算)
    const isBeached = sheenData.hitCount > 0;
    let beachedTons = 0;
    let beachedPct = 0;
    let beachedCoastlineKm = 0;
    let touchedCountyNames = [];
    let seaRemainingTons = volume;

    if (isBeached) {
      const contactRatio = sheenData.hitCount / 72.0;
      sheenData.touchedSegments.forEach((seg) => {
        beachedCoastlineKm += seg.lenKm;
      });
      beachedCoastlineKm = Math.max(0.6, beachedCoastlineKm);

      touchedCountyNames = Array.from(new Set(sheenData.touchedSegments.map((s) => s.county).filter(Boolean)));
      if (touchedCountyNames.length === 0) {
        touchedCountyNames = [nearestPort.county];
      }

      // 拍岸擱淺受污累計油量推算 (受海浪湧流推擠岸際堆積)
      beachedTons = Math.min(volume * 0.70, volume * (0.16 + 0.48 * contactRatio) * (1 - Math.exp(-0.065 * hours)));
      beachedPct = (beachedTons / volume) * 100;
      const naturalLossTons = volume * 0.15 * Math.min(1, hours / 36);
      seaRemainingTons = Math.max(0, volume - beachedTons - naturalLossTons);
    } else {
      const naturalLossTons = volume * 0.12 * Math.min(1, hours / 48);
      seaRemainingTons = Math.max(0, volume - naturalLossTons);
    }

    // 7. 沿岸拍岸預警評估 (Shoreline Beaching ETA)
    const distToCoastNm = Math.max(0, minDistance - (sheenMinorKm / 1.852));
    let beachingEta = "";
    if (isBeached) {
      beachingEta = `🚨 油膜已接觸海岸！正持續沿岸際堆積沉積 (已累計 ${beachedTons.toFixed(1)} 噸)`;
    } else if (distToCoastNm <= 0.3) {
      beachingEta = "⚠️ 油膜前鋒逼近海岸線 (<0.3 nm)，即將接觸潮間帶！";
    } else {
      const estHours = (distToCoastNm / Math.max(0.6, driftSpeed)).toFixed(1);
      beachingEta = `約 ${estHours} 小時後接觸沿岸 (距岸約 ${distToCoastNm.toFixed(1)} 海浬)`;
    }

    // 8. 海事防污應變決策指引
    let boomAdvice = "";
    let opAdvice = "";
    if (volume <= 50) {
      boomAdvice = "建議港口航道佈設 600 公尺港灣型防污攔油索。";
      opAdvice = "派遣港勤除污艇 2 艘、汲油器 2 組展開油膜圍捕；嚴禁於近岸水淺處使用化學分散劑。";
    } else if (volume <= 300) {
      boomAdvice = "建議於商港防波堤主航道佈設 1,200 公尺雙層高強度防污攔油索。";
      opAdvice = "海保署調派大型汲油船進駐，於重度油帶上風處作業；發布港灣航行通告實施船舶分流。";
    } else {
      boomAdvice = "重大海難一級開設！調度全臺聯防物資，佈設 2,500 公尺外海充氣式抗浪攔油索。";
      opAdvice = "全港航道實施緊急管制，調集跨區汲油船隊與自吸式吸油索，優先圍阻阻絕油污進入濕地與養殖區。";
    }

    // ==========================================
    // Leaflet 地圖視覺化圖層繪製 (依海流現況標示)
    // ==========================================

    // Layer 0: 周遭海面即時海流動態流向箭頭矩陣 (Ambient Current Streamline Field)
    const arrowGrid = [
      [-0.10, -0.12], [-0.10, 0.00], [-0.10, 0.12],
      [0.00, -0.14],                 [0.00, 0.14],
      [0.10, -0.12],  [0.10, 0.00],  [0.10, 0.12]
    ];
    arrowGrid.forEach(([dLa, dLo]) => {
      const aLat = originLat + dLa;
      const aLng = originLng + dLo;
      const arrowIcon = L.divIcon({
        className: "leaflet-div-icon",
        html: `
          <div class="ambient-current-arrow" style="transform: rotate(${driftAngle}deg);" title="海流現況 ｜ 流向: ${driftAngle}° (${seaCurrent.compassText}) ｜ 流速: ${driftSpeed} 節">
            <svg viewBox="0 0 24 24" fill="none" stroke="#00f2fe" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="21" x2="12" y2="4"></line>
              <polyline points="6 10 12 4 18 10"></polyline>
            </svg>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      L.marker([aLat, aLng], { icon: arrowIcon, interactive: true, zIndexOffset: 150 })
        .bindTooltip(`🌊 當前海流現況 ｜ 流向: ${driftAngle}° (${seaCurrent.compassText}) ｜ 流速: ${driftSpeed} 節`, { sticky: true })
        .addTo(this.spillLayerGroup);
    });

    // Layer 1: 輕度油光外圍多邊形 (黃色，嚴格依海岸線阻絕裁切，零陸地滲入)
    const sheenPoly = L.polygon(sheenData.pts, {
      color: "#eab308",
      weight: 1.5,
      dashArray: "4, 4",
      fillColor: "#facc15",
      fillOpacity: 0.22
    }).addTo(this.spillLayerGroup);
    sheenPoly.bindTooltip(`🟡 輕度油光外圍 (前鋒油膜，厚度 < 0.1mm)<br>預估擴散面積：${sheenAreaKm2.toFixed(1)} km²<br>最遠擴散半徑：${maxRadiusNm.toFixed(1)} nm<br>海岸線狀態：${isBeached ? "⚠️ 油膜已被海岸阻截，停止流入陸域" : "外海漂移中"}`, { sticky: true });

    // Layer 2: 中度擴散油帶多邊形 (橘色，依海岸線裁切)
    const modPoly = L.polygon(modData.pts, {
      color: "#ea580c",
      weight: 2,
      fillColor: "#f97316",
      fillOpacity: 0.42
    }).addTo(this.spillLayerGroup);
    modPoly.bindTooltip(`🟠 中度擴散油帶 (乳化水包油層，厚度 0.1~1.0mm)<br>油帶面積：${modAreaKm2.toFixed(1)} km²`, { sticky: true });

    // Layer 3: 重度核心油膜區多邊形 (深紅/焦油黑，依海岸線裁切)
    const heavyPoly = L.polygon(heavyData.pts, {
      color: "#dc2626",
      weight: 2.5,
      fillColor: "#7f1d1d",
      fillOpacity: 0.75
    }).addTo(this.spillLayerGroup);
    heavyPoly.bindTooltip(`🔴 重度核心油膜區 (黑焦油厚塊，厚度 > 1.0mm)<br>核心面積：${heavyAreaKm2.toFixed(2)} km²`, { sticky: true });

    // Layer 3.5: 繪製受污岸際沉積線 (Impacted Shoreline Warning Polylines)
    if (isBeached) {
      sheenData.touchedSegments.forEach((seg) => {
        L.polyline([[seg.p1[1], seg.p1[0]], [seg.p2[1], seg.p2[0]]], {
          color: "#ef4444",
          weight: 6,
          opacity: 0.95,
          className: "beached-shore-line"
        }).bindTooltip(`🏖️ 岸際油污沉積擱淺段 (${seg.county})<br>累計沉積油量：${beachedTons.toFixed(1)} 噸 (${beachedPct.toFixed(1)}%)<br>長度：${seg.lenKm.toFixed(1)} km<br>⚠️ 已被海岸線阻截，未滲入陸域`, { sticky: true })
          .addTo(this.spillLayerGroup);
      });

      // 在受污岸際中心點標記「岸際油污累計沉積旗標」
      if (sheenData.touchedSegments.length > 0) {
        const midSeg = sheenData.touchedSegments[Math.floor(sheenData.touchedSegments.length / 2)];
        const midPt = [(midSeg.p1[1] + midSeg.p2[1]) / 2, (midSeg.p1[0] + midSeg.p2[0]) / 2];
        const coastalBadgeIcon = L.divIcon({
          className: "leaflet-div-icon",
          html: `<div class="coastal-accumulation-badge">🏖️ 岸際油污沉積段 ｜ 累計: ${beachedTons.toFixed(1)} 噸 (${beachedPct.toFixed(1)}%) ｜ 受污岸線: ${beachedCoastlineKm.toFixed(1)} km</div>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0]
        });
        L.marker(midPt, { icon: coastalBadgeIcon, zIndexOffset: 750 }).addTo(this.spillLayerGroup);
      }
    }

    // Layer 4: 海流驅動預估擴散主方向向量軸 (青色動態虛線)
    const vectorLine = L.polyline([this.spillSim.origin, [centerLat, centerLng]], {
      color: "#00f2fe",
      weight: 3.0,
      dashArray: "6, 6"
    }).addTo(this.spillLayerGroup);
    vectorLine.bindTooltip(`🧭 依海流預估擴散主方向：${driftAngle}° (${seaCurrent.compassText}) ｜ 流速：${driftSpeed} 節`, {
      permanent: false,
      sticky: true,
      className: "spill-vector-tooltip"
    });

    // 向量端點標記：依使用者需求縮小為微型點狀符號 (Point Dot Marker)
    const directionDotIcon = L.divIcon({
      className: "leaflet-div-icon",
      html: `
        <div class="dispersion-direction-dot-wrap" title="預估擴散主方向中心點">
          <div class="direction-dot-pulse"></div>
          <div class="direction-dot-core"></div>
        </div>
      `,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });
    const dirMarker = L.marker([centerLat, centerLng], { icon: directionDotIcon, zIndexOffset: 700 }).addTo(this.spillLayerGroup);
    dirMarker.bindTooltip(`🧭 預估擴散主方向：${driftAngle}° (${seaCurrent.compassText}) ｜ 實時海流：${driftSpeed} 節`, {
      sticky: true,
      direction: "top",
      className: "spill-vector-tooltip"
    });

    // Layer 5: 漂移軌跡推延時間節點 (T+3h, T+6h, T+12h, T+24h, T+48h, T+72h)
    const milestones = [3, 6, 12, 24, 48, 72].filter((m) => m < hours);
    milestones.forEach((m) => {
      const mNet = Math.max(0.1, (residualSpeed * m) + (tidalOsc * 1.5 * Math.sin((2 * Math.PI * m) / 24.84)));
      const mDLat = (mNet * Math.cos(rad)) / 60.0;
      const mDLng = (mNet * Math.sin(rad)) / (60.0 * Math.cos(originLat * Math.PI / 180));
      const mPt = [originLat + mDLat, originLng + mDLng];

      const mIcon = L.divIcon({
        className: "leaflet-div-icon",
        html: `<div class="milestone-marker-icon"></div>`,
        iconSize: [8, 8],
        iconAnchor: [4, 4]
      });
      L.marker(mPt, { icon: mIcon, zIndexOffset: 550 })
        .bindTooltip(`⏱️ 預估 T+${m}h 擴散中心 (漂移 ${mNet.toFixed(1)} nm)`, { sticky: true })
        .addTo(this.spillLayerGroup);
    });

    // Layer 6: 沉船事故點標記 (Shipwreck Marker)
    const shipwreckIcon = L.divIcon({
      className: "leaflet-div-icon",
      html: `
        <div class="shipwreck-marker-icon" title="船難沉沒點: ${this.spillSim.shipName}">
          <div class="shipwreck-pulse-ring"></div>
          <div class="shipwreck-core">🚢</div>
        </div>
      `,
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    });

    const shipwreckMarker = L.marker(this.spillSim.origin, {
      icon: shipwreckIcon,
      zIndexOffset: 600
    }).addTo(this.spillLayerGroup);

    shipwreckMarker.bindPopup(`
      <div style="font-family: inherit; font-size: 0.82rem; line-height: 1.5; color: #1e293b; min-width: 220px;">
        <div style="font-weight: 700; color: #dc2626; font-size: 0.92rem; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
          <span>🚢💥 假設船難沉沒事故點</span>
        </div>
        <div><strong>遇險船舶：</strong>${this.spillSim.shipName}</div>
        <div><strong>沉沒座標：</strong>${this.spillSim.origin[0].toFixed(4)}°N, ${this.spillSim.origin[1].toFixed(4)}°E</div>
        <div><strong>外洩原油：</strong>${this.spillSim.volume} 公噸 (重柴油/原油)</div>
        <div><strong>經過時間：</strong>${this.spillSim.hours} 小時</div>
        <div style="margin-top: 6px; padding: 4px 6px; background: #fee2e2; border-left: 3px solid #ef4444; border-radius: 4px; font-size: 0.74rem; color: #991b1b;">
          ${this.spillSim.cargoDesc}
        </div>
      </div>
    `);

    // ==========================================
    // 更新控制面板 DOM 數據數值
    // ==========================================
    const hoursDisplay = document.getElementById("spill-hours-display");
    if (hoursDisplay) hoursDisplay.textContent = `${this.spillSim.hours} 小時`;

    const slider = document.getElementById("spill-hours-slider");
    if (slider && Number(slider.value) !== this.spillSim.hours) {
      slider.value = this.spillSim.hours;
    }

    const heavyEl = document.getElementById("metric-heavy-area");
    if (heavyEl) heavyEl.textContent = `${heavyAreaKm2.toFixed(2)} km²`;

    const modEl = document.getElementById("metric-mod-area");
    if (modEl) modEl.textContent = `${modAreaKm2.toFixed(2)} km²`;

    const totalEl = document.getElementById("metric-total-area");
    if (totalEl) totalEl.textContent = `${sheenAreaKm2.toFixed(2)} km²`;

    const radiusEl = document.getElementById("metric-drift-radius");
    if (radiusEl) radiusEl.textContent = `${maxRadiusNm.toFixed(1)} nm`;

    // 當前海面海流現況數值
    const curSystemEl = document.getElementById("spill-current-system");
    if (curSystemEl) curSystemEl.textContent = seaCurrent.currentSystem;

    const curBearingEl = document.getElementById("spill-current-bearing");
    if (curBearingEl) curBearingEl.textContent = `${driftAngle}° (${seaCurrent.compassText})`;

    const curSpeedEl = document.getElementById("spill-current-speed");
    if (curSpeedEl) curSpeedEl.textContent = `${driftSpeed} 節 (~${(driftSpeed * 0.5144).toFixed(2)} m/s)`;

    const dispHeadingEl = document.getElementById("spill-dispersion-heading");
    if (dispHeadingEl) dispHeadingEl.textContent = seaCurrent.dispersionHeading;

    const totalAreaBoxEl = document.getElementById("spill-total-area-box");
    if (totalAreaBoxEl) totalAreaBoxEl.textContent = `${sheenAreaKm2.toFixed(1)} km²`;

    const driftEl = document.getElementById("spill-current-drift");
    if (driftEl) driftEl.textContent = seaCurrent.driftMechanism;

    const nearestEl = document.getElementById("spill-nearest-port");
    if (nearestEl) nearestEl.textContent = `${nearestPort.name} (${distToNearestPort.toFixed(1)} nm ｜ ${threatLevel})`;

    const beachingEl = document.getElementById("spill-beaching-eta");
    if (beachingEl) beachingEl.textContent = beachingEta;

    const advEl = document.getElementById("spill-advisory-text");
    if (advEl) advEl.textContent = `${boomAdvice} ${opAdvice}`;

    // 岸際阻截與油污累計監測 DOM 更新
    const coastalBox = document.getElementById("spill-coastal-box");
    const coastalStatusBadge = document.getElementById("coastal-status-badge");
    const coastalStateEl = document.getElementById("coastal-contact-state");
    const coastalAccumEl = document.getElementById("coastal-accum-tons");
    const coastalSeaEl = document.getElementById("coastal-sea-remaining");
    const coastalLenEl = document.getElementById("coastal-impact-length");
    const coastalLocEl = document.getElementById("coastal-impact-locations");
    const coastalActionEl = document.getElementById("coastal-cleanup-action");

    if (isBeached) {
      if (coastalBox) coastalBox.classList.add("beached-active");
      if (coastalStatusBadge) {
        coastalStatusBadge.className = "coastal-contact-badge contact-danger";
        coastalStatusBadge.textContent = "🚨 已拍岸！油污沉積中";
      }
      if (coastalStateEl) {
        coastalStateEl.innerHTML = `<span class="text-red">🚨 已觸岸阻截 (全面防止滲入陸域)</span>`;
      }
      if (coastalAccumEl) coastalAccumEl.textContent = `${beachedTons.toFixed(1)} 噸 (${beachedPct.toFixed(1)}%)`;
      if (coastalSeaEl) coastalSeaEl.textContent = `${seaRemainingTons.toFixed(1)} 噸`;
      if (coastalLenEl) coastalLenEl.textContent = `${beachedCoastlineKm.toFixed(1)} 公里`;
      if (coastalLocEl) coastalLocEl.textContent = `${touchedCountyNames.join("、")} 沿岸潮間帶與消波塊岸際`;
      if (coastalActionEl) {
        coastalActionEl.textContent = "啟動第三階段岸際防污！沿高潮線佈設陸上吸油索，調派高壓熱水洗石車與重型真空抽吸車抽除潮間帶油泥，嚴禁油水流向陸域，禁止於近岸使用化學分散劑。";
      }
    } else {
      if (coastalBox) coastalBox.classList.remove("beached-active");
      if (coastalStatusBadge) {
        coastalStatusBadge.className = "coastal-contact-badge contact-safe";
        coastalStatusBadge.textContent = "🌊 外海漂移中";
      }
      if (coastalStateEl) {
        coastalStateEl.innerHTML = `<span class="text-cyan">未接觸海岸 (陸域已隔離安全)</span>`;
      }
      if (coastalAccumEl) coastalAccumEl.textContent = "0.0 噸 (0.0%)";
      if (coastalSeaEl) coastalSeaEl.textContent = `${seaRemainingTons.toFixed(1)} 噸`;
      if (coastalLenEl) coastalLenEl.textContent = "0.0 公里";
      if (coastalLocEl) coastalLocEl.textContent = "油膜尚在距岸安全海域漂移";
      if (coastalActionEl) {
        coastalActionEl.textContent = "持續監控海流與潮流推移；於迎流向之商港口門與沿岸敏感水域預先佈設防污攔油索。";
      }
    }
  }
}

// 啟動應用程式
window.addEventListener("DOMContentLoaded", () => {
  window.app = new TaiwanTideApp();
});
