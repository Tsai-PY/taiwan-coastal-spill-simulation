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
    this.renderMapMarkers();
    this.initSpillSimulation();

    // 每 1 秒鐘即時更新時鐘
    setInterval(() => {
      this.now = new Date();
      this.updateClock();
    }, 1000);
  }

  /* -------------------------------------------------------------
     1. 地圖初始化 (Leaflet)
     ------------------------------------------------------------- */
  initMap() {
    const isMobile = window.innerWidth <= 768;
    const initialCenter = isMobile ? [23.7, 120.95] : [23.95, 121.0];
    const initialZoom = isMobile ? 6.8 : 7.8;

    // 臺灣中心經緯度，完整包容五大商港 (手機直向螢幕自動適應為 23.7°N, 120.95°E, zoom 6.8)
    this.map = L.map("map", {
      center: initialCenter,
      zoom: initialZoom,
      zoomSnap: 0.1,
      minZoom: 5.5,
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
     3. 地圖主要商港地名標記 (僅保留地名作為沿岸地理標示)
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
        zIndexOffset: 100,
        interactive: false
      });

      marker.addTo(this.map);
      this.markers[port.id] = marker;
    });
  }

  createPortMarkerHtml(port) {
    return `
      <div class="port-marker-container port-landmark-only" id="marker-${port.id}" style="pointer-events: none;">
        <div class="port-side-badge port-name-only-badge" style="pointer-events: none;">
          <span class="badge-port-name">${port.name}</span>
        </div>
      </div>
    `;
  }




  /* -------------------------------------------------------------
     10. 臺灣周邊海域海流推演情境定位 (Sea Area Current Presets)
     ------------------------------------------------------------- */
  selectSeaArea(sea) {
    const isMobile = window.innerWidth <= 768;
    if (sea === "all") {
      this.map.flyTo(isMobile ? [23.7, 120.95] : [23.95, 121.0], isMobile ? 6.8 : 7.8, { duration: 1.2 });
    } else if (sea === "north") {
      this.setSpillCoordinates(25.3200, 121.5500, true, false);
    } else if (sea === "strait") {
      this.setSpillCoordinates(24.1500, 120.3000, true, false);
    } else if (sea === "south") {
      this.setSpillCoordinates(22.5800, 120.1500, true, false);
    } else if (sea === "east") {
      this.setSpillCoordinates(23.9500, 121.8500, true, false);
    }
  }

  /* -------------------------------------------------------------
     11. 事件監聽綁定
     ------------------------------------------------------------- */
  initEventListeners() {
    // 臺灣周邊海域海流快速定位按鈕
    document.querySelectorAll(".sea-area-btn-group .ctrl-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".sea-area-btn-group .ctrl-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.selectSeaArea(btn.dataset.sea);
      });
    });

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

    // 手機版點擊面板標題列或拖曳條展開/收合抽屜
    const spillHeader = document.getElementById("spill-panel-header");
    if (spillHeader) {
      spillHeader.addEventListener("click", (e) => {
        if (e.target.closest("#btn-spill-close") || e.target.closest("#btn-spill-minimize")) {
          return;
        }
        if (window.innerWidth <= 768) {
          this.toggleSpillMinimize();
        }
      });
    }

    // 視窗縮放與方向變換時適配按鈕文字與 Peek 摘要
    window.addEventListener("resize", () => {
      this.updateMobilePeekSummary();
      const minBtn = document.getElementById("btn-spill-minimize");
      if (minBtn) {
        const isMobile = window.innerWidth <= 768;
        if (this.spillSim.isMinimized) {
          minBtn.textContent = isMobile ? "▲ 展開" : "▢";
        } else {
          minBtn.textContent = isMobile ? "▼ 收合" : "_";
        }
      }
    });

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

    if (panel) {
      panel.style.display = "flex";
    }
    if (toggleBtn) {
      toggleBtn.classList.add("active");
    }

    // 依手機版登入適配需求：預設以底部收合 Peek 模式啟動，完整露出臺灣地圖海面供自由點選
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      this.spillSim.isMinimized = true;
      if (panel) panel.classList.add("minimized");
      const minBtn = document.getElementById("btn-spill-minimize");
      if (minBtn) {
        minBtn.textContent = "▲ 展開";
        minBtn.title = "展開推演面板";
      }
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
    if (!panel || !toggleBtn) return;

    const nextState = forceState !== undefined ? forceState : !this.spillSim.isOpen;
    this.spillSim.isOpen = nextState;

    if (this.spillSim.isOpen) {
      panel.style.display = "flex";
      toggleBtn.classList.add("active");

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
    const isMobile = window.innerWidth <= 768;
    if (this.spillSim.isMinimized) {
      panel.classList.add("minimized");
      btn.textContent = isMobile ? "▲ 展開" : "▢";
      btn.title = "展開推演面板";
    } else {
      panel.classList.remove("minimized");
      btn.textContent = isMobile ? "▼ 收合" : "_";
      btn.title = "收合推演面板";
    }
    this.updateMobilePeekSummary();
  }

  updateMobilePeekSummary() {
    const summaryEl = document.getElementById("mobile-peek-summary");
    if (!summaryEl) return;
    if (this.spillSim.isMinimized) {
      summaryEl.textContent = `T+${this.spillSim.hours}h ｜ ${this.spillSim.volume}噸 ｜ 點此展開 ▲`;
    } else {
      summaryEl.textContent = `點此收合面板 ▼`;
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

    const driftCenterEl = document.getElementById("spill-drift-center-coords");
    if (driftCenterEl) driftCenterEl.textContent = `${centerLat.toFixed(4)}°N, ${centerLng.toFixed(4)}°E`;


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

    // 同步更新手機版底部收合條之時間與規模摘要
    this.updateMobilePeekSummary();
  }
}

// 啟動應用程式
window.addEventListener("DOMContentLoaded", () => {
  window.app = new TaiwanTideApp();
});
