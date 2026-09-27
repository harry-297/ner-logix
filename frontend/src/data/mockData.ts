/* ============================================================
   NER-LOGIX — Shared Mock / Demo Data
   ------------------------------------------------------------
   Central place for all "faked" data used across the prototype
   (Vehicles, Incidents, Alerts, Analytics, Settings). Wiring a
   real backend later just means swapping these constants for
   API calls with the same shape.
   ============================================================ */

export type Severity = "Low" | "Moderate" | "High" | "Critical";

export const STATES = [
  "Assam",
  "Sikkim",
  "Meghalaya",
  "Arunachal Pradesh",
  "Manipur",
  "Mizoram",
  "Nagaland",
  "Tripura",
];

/* ---------------------------------------------------------- */
/* VEHICLES                                                    */
/* ---------------------------------------------------------- */

export type CargoType =
  | "Medicines"
  | "Food Supplies"
  | "Construction Material"
  | "Agricultural Produce"
  | "Fuel & Essentials";

export type VehicleStatus =
  | "Moving"
  | "Idle"
  | "Delayed"
  | "Arrived"
  | "Rerouted";

export interface Vehicle {
  id: string;
  regNumber: string;
  cargo: CargoType;
  operator: string;
  driver: string;
  origin: string;
  destination: string;
  currentLocation: string;
  status: VehicleStatus;
  speedKmph: number;
  progressPct: number;
  etaMinutes: number;
  lastPing: string;
  riskLevel: Severity;
  gpsLat: number;
  gpsLng: number;
}

export const vehicles: Vehicle[] = [
  { id: "VH-1042", regNumber: "AS-01-GJ-3341", cargo: "Medicines", operator: "NER Health Logistics", driver: "T. Barman", origin: "Guwahati", destination: "Tawang", currentLocation: "Bomdila, Arunachal Pradesh", status: "Moving", speedKmph: 34, progressPct: 62, etaMinutes: 145, lastPing: "18 sec ago", riskLevel: "Moderate", gpsLat: 27.264, gpsLng: 92.405 },
  { id: "VH-1043", regNumber: "ML-05-AB-1187", cargo: "Food Supplies", operator: "State Civil Supplies", driver: "K. Marak", origin: "Shillong", destination: "Nongstoin", currentLocation: "Mairang, Meghalaya", status: "Delayed", speedKmph: 6, progressPct: 41, etaMinutes: 210, lastPing: "42 sec ago", riskLevel: "High", gpsLat: 25.567, gpsLng: 91.633 },
  { id: "VH-1044", regNumber: "SK-02-CT-0921", cargo: "Construction Material", operator: "BRO Contractor Unit", driver: "P. Rai", origin: "Gangtok", destination: "Mangan", currentLocation: "Singhik, Sikkim", status: "Rerouted", speedKmph: 21, progressPct: 55, etaMinutes: 95, lastPing: "1 min ago", riskLevel: "Critical", gpsLat: 27.452, gpsLng: 88.533 },
  { id: "VH-1045", regNumber: "MN-01-DE-4521", cargo: "Agricultural Produce", operator: "Farmers FPO Cooperative", driver: "N. Singh", origin: "Imphal", destination: "Ukhrul", currentLocation: "Litan, Manipur", status: "Moving", speedKmph: 28, progressPct: 33, etaMinutes: 160, lastPing: "9 sec ago", riskLevel: "Moderate", gpsLat: 25.05, gpsLng: 94.15 },
  { id: "VH-1046", regNumber: "AS-09-JH-7712", cargo: "Fuel & Essentials", operator: "IOCL Regional Depot", driver: "R. Das", origin: "Dibrugarh", destination: "Ziro", currentLocation: "North Lakhimpur, Assam", status: "Moving", speedKmph: 45, progressPct: 18, etaMinutes: 280, lastPing: "26 sec ago", riskLevel: "Low", gpsLat: 27.24, gpsLng: 94.10 },
  { id: "VH-1047", regNumber: "TR-03-FG-2290", cargo: "Medicines", operator: "NER Health Logistics", driver: "A. Debbarma", origin: "Agartala", destination: "Kanchanpur", currentLocation: "Kanchanpur, Tripura", status: "Arrived", speedKmph: 0, progressPct: 100, etaMinutes: 0, lastPing: "2 min ago", riskLevel: "Low", gpsLat: 24.29, gpsLng: 92.18 },
  { id: "VH-1048", regNumber: "NL-01-KL-5563", cargo: "Food Supplies", operator: "State Civil Supplies", driver: "Z. Lotha", origin: "Kohima", destination: "Zunheboto", currentLocation: "Satakha, Nagaland", status: "Idle", speedKmph: 0, progressPct: 47, etaMinutes: 120, lastPing: "5 min ago", riskLevel: "High", gpsLat: 26.20, gpsLng: 94.45 },
  { id: "VH-1049", regNumber: "MZ-02-MN-9034", cargo: "Construction Material", operator: "PWD Mizoram", driver: "L. Sailo", origin: "Aizawl", destination: "Lunglei", currentLocation: "Thenzawl, Mizoram", status: "Moving", speedKmph: 31, progressPct: 70, etaMinutes: 65, lastPing: "14 sec ago", riskLevel: "Moderate", gpsLat: 23.29, gpsLng: 92.75 },
];

/* ---------------------------------------------------------- */
/* INCIDENTS                                                   */
/* ---------------------------------------------------------- */

export type IncidentType =
  | "Landslide"
  | "Flood"
  | "Road Damage"
  | "Bridge Risk"
  | "Traffic Congestion"
  | "Heavy Rainfall";

export type IncidentStatus = "Active" | "Under Verification" | "Resolved";
export type IncidentSource = "Field Officer" | "Citizen Report" | "IoT Sensor" | "Satellite Feed" | "Weather API";

export interface Incident {
  id: string;
  type: IncidentType;
  severity: Severity;
  title: string;
  description: string;
  state: string;
  district: string;
  road: string;
  source: IncidentSource;
  status: IncidentStatus;
  reportedAt: string;
  hasPhoto: boolean;
  reportedBy: string;
}

export const incidents: Incident[] = [
  { id: "INC-4471", type: "Landslide", severity: "Critical", title: "Major landslide blocks NH-10", description: "Debris flow across both lanes near Rangpo after continuous rainfall; heavy machinery requested.", state: "Sikkim", district: "Pakyong", road: "NH-10", source: "Field Officer", status: "Active", reportedAt: "12 min ago", hasPhoto: true, reportedBy: "R. Lepcha, PWD Field Unit" },
  { id: "INC-4470", type: "Flood", severity: "High", title: "Approach road submerged near Dhemaji", description: "Brahmaputra tributary overflow has submerged 300m stretch; only high-clearance vehicles passable.", state: "Assam", district: "Dhemaji", road: "SH-7", source: "IoT Sensor", status: "Active", reportedAt: "27 min ago", hasPhoto: true, reportedBy: "Auto-detected — river gauge sensor" },
  { id: "INC-4469", type: "Road Damage", severity: "Moderate", title: "Pothole cluster after monsoon runoff", description: "Surface erosion reported on a 1.2 km section, passable at reduced speed.", state: "Arunachal Pradesh", district: "West Kameng", road: "NH-13", source: "Citizen Report", status: "Under Verification", reportedAt: "41 min ago", hasPhoto: false, reportedBy: "Local resident (mobile app)" },
  { id: "INC-4468", type: "Bridge Risk", severity: "High", title: "Structural stress on suspension bridge", description: "Vibration sensors flagged load-bearing concerns; weight restriction advised pending inspection.", state: "Manipur", district: "Imphal East", road: "Iril Bridge", source: "IoT Sensor", status: "Active", reportedAt: "1 hr ago", hasPhoto: true, reportedBy: "Auto-detected — structural sensor" },
  { id: "INC-4467", type: "Traffic Congestion", severity: "Low", title: "Convoy delay near timber checkpoint", description: "Slow-moving convoy causing 20-30 min delays; alternate route advised for time-sensitive cargo.", state: "Meghalaya", district: "West Khasi Hills", road: "SH-5", source: "Field Officer", status: "Active", reportedAt: "1 hr 20 min ago", hasPhoto: false, reportedBy: "S. Marak, District Transport Office" },
  { id: "INC-4466", type: "Heavy Rainfall", severity: "Moderate", title: "IMD red alert issued for next 24 hrs", description: "Predictive model flags elevated landslide risk along hill corridors in the next 24-48 hours.", state: "Sikkim", district: "North Sikkim", road: "NH-10 / Corridor", source: "Weather API", status: "Active", reportedAt: "2 hr ago", hasPhoto: false, reportedBy: "IMD Weather Feed (automated)" },
  { id: "INC-4465", type: "Landslide", severity: "Moderate", title: "Minor slide cleared, monitoring continues", description: "Debris cleared by district team; corridor reopened with a 20 km/h advisory.", state: "Mizoram", district: "Lunglei", road: "NH-54", source: "Field Officer", status: "Resolved", reportedAt: "3 hr ago", hasPhoto: true, reportedBy: "V. Ralte, District Disaster Cell" },
  { id: "INC-4464", type: "Road Damage", severity: "Low", title: "Culvert repair work in progress", description: "Single-lane passage available; delays of 10-15 minutes expected until repair completes.", state: "Nagaland", district: "Zunheboto", road: "SH-2", source: "Field Officer", status: "Under Verification", reportedAt: "4 hr ago", hasPhoto: false, reportedBy: "PWD Nagaland Field Team" },
];

/* ---------------------------------------------------------- */
/* ALERTS                                                       */
/* ---------------------------------------------------------- */

export type AlertCategory =
  | "Blocked Road"
  | "High-Risk Corridor"
  | "Delivery Delay"
  | "Weather Warning"
  | "Region Inaccessible";

export interface AlertItem {
  id: string;
  category: AlertCategory;
  severity: Severity;
  title: string;
  detail: string;
  district: string;
  time: string;
  channels: string[];
  translations: Record<string, string>;
}

export const alerts: AlertItem[] = [
  {
    id: "ALT-901",
    category: "Blocked Road",
    severity: "Critical",
    title: "NH-10 fully blocked near Rangpo",
    detail: "Landslide debris covers both carriageways. All essential-cargo movement rerouted via SH-12 alternate corridor.",
    district: "Pakyong, Sikkim",
    time: "10 min ago",
    channels: ["App Push", "SMS", "IVR Voice Call"],
    translations: {
      English: "NH-10 fully blocked near Rangpo. All essential-cargo movement rerouted via SH-12.",
      Hindi: "रंगपो के पास एनएच-10 पूरी तरह बंद है। आवश्यक सामान की आवाजाही एसएच-12 वैकल्पिक मार्ग से भेजी जा रही है।",
      Assamese: "ৰাংপোৰ ওচৰত NH-10 সম্পূৰ্ণৰূপে বন্ধ। প্ৰয়োজনীয় সামগ্ৰী পৰিবহন SH-12 বিকল্প পথেৰে পুনৰনিৰ্দেশিত।",
      Nepali: "रङ्पो नजिक NH-10 पूर्ण रूपमा बन्द छ। आवश्यक सामानको ढुवानी SH-12 वैकल्पिक मार्गबाट पठाइँदैछ।",
    },
  },
  {
    id: "ALT-900",
    category: "Region Inaccessible",
    severity: "High",
    title: "Dhemaji district — 3 villages cut off",
    detail: "Flood waters have isolated Machkhowa, Simen Chapori and Bordoloni. Emergency supply drop coordinated with district authority.",
    district: "Dhemaji, Assam",
    time: "25 min ago",
    channels: ["App Push", "SMS"],
    translations: {
      English: "Dhemaji: 3 villages cut off by flood water. Emergency supply drop coordinated with district authority.",
      Hindi: "धेमाजी: बाढ़ के पानी से 3 गांव कटे हुए हैं। जिला प्रशासन के साथ आपातकालीन आपूर्ति की व्यवस्था की जा रही है।",
      Assamese: "ধেমাজী: বানপানীৰ বাবে ৩খন গাঁও বিচ্ছিন্ন। জিলা প্ৰশাসনৰ সৈতে জৰুৰীকালীন যোগান সমন্বয় কৰা হৈছে।",
      Nepali: "धेमाजी: बाढीको पानीले ३ गाउँ अलग भएका छन्। जिल्ला प्रशासनसँग आपतकालीन आपूर्ति समन्वय गरिँदैछ।",
    },
  },
  {
    id: "ALT-899",
    category: "High-Risk Corridor",
    severity: "High",
    title: "Bridge weight restriction — Iril Bridge",
    detail: "Structural sensors flag load stress. Vehicles above 9T restricted until inspection completes (ETA 6 hrs).",
    district: "Imphal East, Manipur",
    time: "48 min ago",
    channels: ["App Push", "SMS", "IVR Voice Call"],
    translations: {
      English: "Iril Bridge: vehicles above 9T restricted until inspection completes.",
      Hindi: "इरिल ब्रिज: निरीक्षण पूर्ण होने तक 9 टन से अधिक भार वाले वाहन प्रतिबंधित।",
      Assamese: "ইৰিল ব্ৰীজ: নিৰীক্ষণ সম্পূৰ্ণ নোহোৱালৈকে ৯ টনতকৈ অধিক ওজনৰ যান নিষিদ্ধ।",
      Nepali: "इरिल पुल: निरीक्षण नसकिँदासम्म ९ टनभन्दा बढी तौलका सवारी साधन प्रतिबन्धित।",
    },
  },
  {
    id: "ALT-898",
    category: "Delivery Delay",
    severity: "Moderate",
    title: "VH-1043 delayed by 65 minutes",
    detail: "Food supply consignment to Nongstoin delayed due to congestion near Mairang. New ETA updated for receiving warehouse.",
    district: "West Khasi Hills, Meghalaya",
    time: "1 hr ago",
    channels: ["App Push"],
    translations: {
      English: "VH-1043 delayed by 65 minutes near Mairang. Receiving warehouse notified with updated ETA.",
      Hindi: "VH-1043, मैराङ के पास 65 मिनट देरी से चल रहा है। प्राप्तकर्ता गोदाम को अद्यतन ईटीए सूचित किया गया।",
      Assamese: "VH-1043 মাইৰাংৰ ওচৰত ৬৫ মিনিট পলম। গুদামত আপডেট কৰা ETA জনোৱা হৈছে।",
      Nepali: "VH-1043 मैराङ नजिक ६५ मिनेट ढिलो छ। गोदाममा अद्यावधिक ETA जानकारी गरिएको छ।",
    },
  },
  {
    id: "ALT-897",
    category: "Weather Warning",
    severity: "Moderate",
    title: "IMD red alert — North Sikkim hill corridors",
    detail: "Heavy rainfall predicted over next 24-48 hrs. Elevated landslide-risk score applied to 6 corridors automatically.",
    district: "North Sikkim, Sikkim",
    time: "2 hr ago",
    channels: ["App Push", "SMS"],
    translations: {
      English: "IMD red alert for North Sikkim. Elevated landslide risk applied to 6 hill corridors.",
      Hindi: "उत्तर सिक्किम के लिए आईएमडी रेड अलर्ट। 6 पहाड़ी गलियारों पर भूस्खलन जोखिम बढ़ाया गया।",
      Assamese: "উত্তৰ সিক্কিমৰ বাবে IMD ৰেড এলাৰ্ট। ৬টা পাহাৰীয়া কৰিডোৰত ভূমিস্খলনৰ বিপদ বৃদ্ধি কৰা হৈছে।",
      Nepali: "उत्तर सिक्किमको लागि IMD रेड अलर्ट। ६ पहाडी करिडोरमा पहिरो जोखिम बढाइएको छ।",
    },
  },
  {
    id: "ALT-896",
    category: "Blocked Road",
    severity: "Low",
    title: "Culvert repair — single lane open, SH-2",
    detail: "Minor delays of 10-15 minutes. Expected to clear by end of day.",
    district: "Zunheboto, Nagaland",
    time: "4 hr ago",
    channels: ["App Push"],
    translations: {
      English: "SH-2 culvert repair in progress. Single lane open, 10-15 min delay expected.",
      Hindi: "SH-2 पर पुलिया मरम्मत जारी। एक लेन खुली, 10-15 मिनट देरी संभव।",
      Assamese: "SH-2 ত কালভাৰ্ট মেৰামতি চলি আছে। এটা লেন খোলা, ১০-১৫ মিনিট পলম হ'ব পাৰে।",
      Nepali: "SH-2 मा कल्भर्ट मर्मत जारी। एउटा लेन खुला, १०-१५ मिनेट ढिलाइ हुन सक्छ।",
    },
  },
];

export const SUPPORTED_LANGUAGES = ["English", "Hindi", "Assamese", "Nepali"];

/* ---------------------------------------------------------- */
/* ANALYTICS                                                    */
/* ---------------------------------------------------------- */

export const districtConnectivity = [
  { state: "Assam", accessible: 78, caution: 14, blocked: 8 },
  { state: "Sikkim", accessible: 52, caution: 28, blocked: 20 },
  { state: "Meghalaya", accessible: 64, caution: 24, blocked: 12 },
  { state: "Arunachal Pr.", accessible: 46, caution: 32, blocked: 22 },
  { state: "Manipur", accessible: 58, caution: 26, blocked: 16 },
  { state: "Mizoram", accessible: 61, caution: 25, blocked: 14 },
  { state: "Nagaland", accessible: 55, caution: 30, blocked: 15 },
  { state: "Tripura", accessible: 82, caution: 12, blocked: 6 },
];

export const disruptionTrend = [
  { day: "Mon", disruptions: 12, resolved: 9 },
  { day: "Tue", disruptions: 15, resolved: 11 },
  { day: "Wed", disruptions: 22, resolved: 14 },
  { day: "Thu", disruptions: 19, resolved: 17 },
  { day: "Fri", disruptions: 27, resolved: 18 },
  { day: "Sat", disruptions: 24, resolved: 21 },
  { day: "Sun", disruptions: 18, resolved: 20 },
];

export const cargoDistribution = [
  { name: "Medicines", value: 22, color: "#e5484d" },
  { name: "Food Supplies", value: 31, color: "#f5a623" },
  { name: "Construction Material", value: 26, color: "#3b82f6" },
  { name: "Agricultural Produce", value: 14, color: "#22c55e" },
  { name: "Fuel & Essentials", value: 7, color: "#8b5cf6" },
];

export const corridorRiskMatrix = [
  { state: "Sikkim", low: 4, moderate: 6, high: 5, critical: 3 },
  { state: "Arunachal Pradesh", low: 6, moderate: 9, high: 7, critical: 4 },
  { state: "Assam", low: 18, moderate: 10, high: 4, critical: 1 },
  { state: "Manipur", low: 7, moderate: 8, high: 5, critical: 2 },
  { state: "Meghalaya", low: 9, moderate: 7, high: 4, critical: 1 },
  { state: "Mizoram", low: 8, moderate: 6, high: 3, critical: 1 },
  { state: "Nagaland", low: 7, moderate: 7, high: 4, critical: 2 },
  { state: "Tripura", low: 12, moderate: 5, high: 2, critical: 0 },
];

export const avgDeliveryDelay = [
  { month: "Apr", delayMin: 62 },
  { month: "May", delayMin: 58 },
  { month: "Jun", delayMin: 74 },
  { month: "Jul", delayMin: 91 },
  { month: "Aug", delayMin: 85 },
  { month: "Sep", delayMin: 67 },
];

/* ---------------------------------------------------------- */
/* EMERGENCY / DISASTER ACCESSIBILITY                           */
/* ---------------------------------------------------------- */

export interface EmergencyRoute {
  id: string;
  name: string;
  purpose: string;
  status: "Open" | "Open with Escort" | "Closed";
  linkedDistricts: string;
}

export const emergencyRoutes: EmergencyRoute[] = [
  { id: "EM-01", name: "Gangtok ↔ Siliguri Relief Corridor", purpose: "Primary evacuation & relief supply route for Sikkim", status: "Open with Escort", linkedDistricts: "East Sikkim, Kalimpong" },
  { id: "EM-02", name: "Dhemaji Flood Response Route", purpose: "Boat + road hybrid access for flood-cut villages", status: "Open", linkedDistricts: "Dhemaji, Lakhimpur" },
  { id: "EM-03", name: "Imphal ↔ Ukhrul Medical Corridor", purpose: "Ambulance & medicine priority lane", status: "Open", linkedDistricts: "Imphal East, Ukhrul" },
  { id: "EM-04", name: "Bomdila Landslide Bypass", purpose: "Alternate access after NH-13 slide closure", status: "Closed", linkedDistricts: "West Kameng" },
];

/* ---------------------------------------------------------- */
/* SYSTEM INTEGRATIONS (Settings)                                */
/* ---------------------------------------------------------- */

export interface Integration {
  name: string;
  type: string;
  status: "Connected" | "Syncing" | "Degraded";
  lastSync: string;
}

export const integrations: Integration[] = [
  { name: "IMD Weather API", type: "Weather & Rainfall Data", status: "Connected", lastSync: "30 sec ago" },
  { name: "State PWD Road Database", type: "Road & Bridge Registry", status: "Connected", lastSync: "2 min ago" },
  { name: "Vehicle Telematics / GPS Gateway", type: "Fleet Tracking", status: "Connected", lastSync: "10 sec ago" },
  { name: "NDMA Disaster Feed", type: "Emergency & Disaster Alerts", status: "Connected", lastSync: "4 min ago" },
  { name: "Border Roads Organisation (BRO)", type: "Terrain & Construction Updates", status: "Syncing", lastSync: "18 min ago" },
  { name: "District Administration Portal", type: "Field Reports & Local Advisories", status: "Connected", lastSync: "1 min ago" },
  { name: "ISRO Bhuvan / Satellite Imagery", type: "GIS & Terrain Mapping", status: "Degraded", lastSync: "56 min ago" },
];
