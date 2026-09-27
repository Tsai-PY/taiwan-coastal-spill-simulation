/**
 * 台灣環島五大商港即時潮位系統 - 測站與潮汐資料集
 * 包含港口：台北港、基隆港、花蓮港、高雄港、台中港
 * 資料來源：交通部中央氣象署全球資訊網 (CWA) 潮汐預報與海象測站資料
 */

const TIDE_PORTS_DATA = [
  // 1. 台北港 (西北端)
  {
    id: "taipei",
    name: "台北港",
    fullName: "新北市八里區 台北港",
    category: "major",
    tag: "北部國際商港",
    zoneId: "NSea03",
    zoneName: "新竹鹿港沿海 (西北海面)",
    county: "新北市",
    town: "八里區",
    cwaStationId: "T500023",
    cwaStationName: "新北市 八里 (台北港)",
    cwaUrl: "https://www.cwa.gov.tw/V8/C/M/Fishery/tide_30day_MOD/T500023.html",
    coords: [25.1539, 121.3857],
    badgeDir: "left", // 標籤浮動於左側海面
    tideDiffGrade: "中",
    depthAvg: 16.5,
    desc: "臺灣北部重要國際綜合商港，鄰近淡水河出海口，設有貨櫃物流、油品、汽車與砂石重件碼頭，為大台北地區海運物流中樞。",
    nauticalNote: "台北港外海潮流沿西北-東南向往復，滿潮與乾潮轉換時流速較緩。吃水深船舶請注意低潮時海圖基準水深餘裕。",
    tides: [
      { type: "乾潮", time: "04:27", twvd: -105, msl: -100, chart_datum: 86 },
      { type: "滿潮", time: "10:26", twvd: 177, msl: 181, chart_datum: 368 },
      { type: "乾潮", time: "16:40", twvd: -129, msl: -124, chart_datum: 62 },
      { type: "滿潮", time: "22:46", twvd: 179, msl: 183, chart_datum: 370 }
    ]
  },

  // 2. 基隆港 (東北端)
  {
    id: "keelung",
    name: "基隆港",
    fullName: "基隆市 基隆港",
    category: "major",
    tag: "東北國際良港",
    zoneId: "NSea01",
    zoneName: "彭佳嶼基隆海面 (東北海面)",
    county: "基隆市",
    town: "中正/中山區",
    cwaStationId: "T001701",
    cwaStationName: "基隆市 中正 (基隆港)",
    cwaUrl: "https://www.cwa.gov.tw/V8/C/M/Fishery/tide_30day_MOD/T001701.html",
    coords: [25.1385, 121.7483],
    badgeDir: "right", // 標籤浮動於右側海面
    tideDiffGrade: "小",
    depthAvg: 15.0,
    desc: "臺灣歷史悠久之天然深水良港，三面環山一面臨海。臺灣高程基準 (TWVD 2001) 起算之水準原點正座落於基隆海面，亦為亞洲頂級國際郵輪母港。",
    nauticalNote: "基隆港潮差較小（日潮差約0.7公尺），潮位穩定受潮汐影響較小，但受東北季風與長浪（湧浪）影響較大，入港需注意湧浪高度。",
    tides: [
      { type: "乾潮", time: "02:11", twvd: 11, msl: -2, chart_datum: 99 },
      { type: "滿潮", time: "08:59", twvd: 60, msl: 46, chart_datum: 148 },
      { type: "乾潮", time: "14:22", twvd: -6, msl: -19, chart_datum: 82 },
      { type: "滿潮", time: "21:25", twvd: 62, msl: 48, chart_datum: 150 }
    ]
  },

  // 3. 花蓮港 (東部端)
  {
    id: "hualien",
    name: "花蓮港",
    fullName: "花蓮縣 花蓮港",
    category: "major",
    tag: "東部太平洋商港",
    zoneId: "NSea12",
    zoneName: "花蓮沿海 (東部海面)",
    county: "花蓮縣",
    town: "花蓮市",
    cwaStationId: "T001501",
    cwaStationName: "花蓮縣 花蓮 (花蓮港)",
    cwaUrl: "https://www.cwa.gov.tw/V8/C/M/Fishery/tide_30day_MOD/T001501.html",
    coords: [23.9872, 121.6288],
    badgeDir: "right", // 標籤浮動於右側太平洋
    tideDiffGrade: "中",
    depthAvg: 15.5,
    desc: "臺灣東部唯一國際商港，直面浩瀚太平洋海溝，離岸不遠水深即達千公尺，以大理石砂石輸出、水泥散裝及太平洋賞鯨觀光著稱。",
    nauticalNote: "東海岸太平洋潮汐為正規半日潮，潮差中等。港口面向東南，受黑潮主流近岸支流與颱風外圍長浪影響較劇烈，進港需注意泊地湧浪週期。",
    tides: [
      { type: "滿潮", time: "05:44", twvd: 96, msl: 106, chart_datum: 218 },
      { type: "乾潮", time: "11:56", twvd: -40, msl: -29, chart_datum: 83 },
      { type: "滿潮", time: "18:07", twvd: 89, msl: 99, chart_datum: 211 },
      { type: "乾潮", time: "23:58", twvd: -38, msl: -27, chart_datum: 85 }
    ]
  },

  // 4. 高雄港 (西南端)
  {
    id: "kaohsiung",
    name: "高雄港",
    fullName: "高雄市 高雄港",
    category: "major",
    tag: "南部樞紐大港",
    zoneId: "NSea06",
    zoneName: "安平高雄沿海 (西南海面)",
    county: "高雄市",
    town: "旗津/鼓山/前鎮區",
    cwaStationId: "T401000",
    cwaStationName: "高雄市 旗津 (高雄港)",
    cwaUrl: "https://www.cwa.gov.tw/V8/C/M/Fishery/tide_30day_MOD/T401000.html",
    coords: [22.6150, 120.2798],
    badgeDir: "left", // 標籤浮動於左側海面
    tideDiffGrade: "小",
    depthAvg: 17.5,
    desc: "臺灣第一大國際貨櫃樞紐港，擁有一港口與二港口雙主航道，全天候受外側防波堤與旗津半島護衛，水深港闊，可供2.4萬TEU超大型貨櫃輪進出。",
    nauticalNote: "高雄港日潮不等現象明顯（混合潮型），兩次滿潮潮高不同。港內水域受防波堤屏障，水流平穩，全天候適合大型貨櫃輪領港靠泊。",
    tides: [
      { type: "乾潮", time: "00:47", twvd: 26, msl: 5, chart_datum: 69 },
      { type: "滿潮", time: "07:05", twvd: 86, msl: 65, chart_datum: 129 },
      { type: "乾潮", time: "13:45", twvd: 19, msl: -1, chart_datum: 62 },
      { type: "滿潮", time: "19:36", twvd: 68, msl: 47, chart_datum: 111 }
    ]
  },

  // 5. 台中港 (西中段)
  {
    id: "taichung",
    name: "台中港",
    fullName: "臺中市 臺中港",
    category: "major",
    tag: "海峽綠能重港",
    zoneId: "NSea03",
    zoneName: "新竹鹿港沿海 (海峽中段)",
    county: "臺中市",
    town: "梧棲/清水區",
    cwaStationId: "T600014",
    cwaStationName: "臺中市 梧棲 (台中港)",
    cwaUrl: "https://www.cwa.gov.tw/V8/C/M/Fishery/tide_30day_MOD/T600014.html",
    coords: [24.2882, 120.5218],
    badgeDir: "left", // 標籤浮動於左側海面
    tideDiffGrade: "大",
    depthAvg: 16.0,
    desc: "臺灣海峽潮差最大商港（潮差近5公尺），為人工深水開敞港，也是國家級離岸風電綠能組裝基地與天然氣LNG接收重鎮。",
    nauticalNote: "【特別警示】臺中港為臺灣潮差極大港口！大潮期滿乾潮位落差可達4.8~5.0米，強潮急流顯著，大型貨輪泊靠繫纜需定時調整纜繩張力。",
    tides: [
      { type: "乾潮", time: "04:31", twvd: -185, msl: -203, chart_datum: 115 },
      { type: "滿潮", time: "10:35", twvd: 285, msl: 266, chart_datum: 585 },
      { type: "乾潮", time: "16:48", twvd: -215, msl: -233, chart_datum: 85 },
      { type: "滿潮", time: "22:56", twvd: 282, msl: 263, chart_datum: 582 }
    ]
  }
];

// 五大商港環島巡航順序 (順時針：台北港 -> 基隆港 -> 花蓮港 -> 高雄港 -> 台中港 -> 回到台北港)
const CIRCUMNAVIGATION_ROUTE = [
  "taipei",    // 1. 台北港 (西北)
  "keelung",   // 2. 基隆港 (東北)
  "hualien",   // 3. 花蓮港 (東部)
  "kaohsiung", // 4. 高雄港 (西南)
  "taichung",  // 5. 台中港 (西中)
  "taipei"     // 回到起點台北港 完成五大商港環島巡航！
];

if (typeof module !== 'undefined') {
  module.exports = { TIDE_PORTS_DATA, CIRCUMNAVIGATION_ROUTE };
}
