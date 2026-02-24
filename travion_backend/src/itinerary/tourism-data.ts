/**
 * State Tourism Data — Maps Indian states/UTs to their official tourism websites
 * and maps cities/destinations to their parent states.
 *
 * Used by:
 *   - TourismAdvisoryService (fetch advisories, festivals, closures)
 *   - TourismPoiService (fetch official tourist spots)
 *   - CrowdMonitorProcessor (festival-based crowd boost)
 */

// ─── STATE TOURISM LINKS ──────────────────────────────────────────────────

export interface StateTourism {
  name: string;
  url: string;
  /** Optional alternate/sub-pages known to have useful structured data */
  altUrls?: string[];
}

export const STATE_TOURISM_MAP: Record<string, StateTourism> = {
  'andaman & nicobar': { name: 'Andaman & Nicobar', url: 'http://www.andaman.gov.in' },
  'andhra pradesh': { name: 'Andhra Pradesh', url: 'https://tourism.ap.gov.in/' },
  'arunachal pradesh': { name: 'Arunachal Pradesh', url: 'http://www.arunachaltourism.com/' },
  'assam': { name: 'Assam', url: 'https://tourism.assam.gov.in/' },
  'bihar': { name: 'Bihar', url: 'http://www.bihartourism.gov.in' },
  'chandigarh': { name: 'Chandigarh', url: 'http://chandigarhtourism.gov.in/' },
  'chhattisgarh': { name: 'Chhattisgarh', url: 'http://chhattisgarhtourism.cg.gov.in' },
  'dadra & nagar haveli': { name: 'Dadra & Nagar Haveli', url: 'https://www.tourismdddnh.in/' },
  'daman and diu': { name: 'Daman and Diu', url: 'https://www.tourismdddnh.in/' },
  'goa': { name: 'Goa', url: 'https://goa-tourism.com/' },
  'gujarat': { name: 'Gujarat', url: 'https://www.gujarattourism.com/' },
  'haryana': { name: 'Haryana', url: 'http://haryanatourism.gov.in/' },
  'himachal pradesh': { name: 'Himachal Pradesh', url: 'https://himachaltourism.gov.in/' },
  'jammu and kashmir': { name: 'Jammu and Kashmir', url: 'http://jammutourism.gov.in/' },
  'ladakh': { name: 'Ladakh', url: 'https://ladakh.nic.in/tourism/' },
  'jharkhand': { name: 'Jharkhand', url: 'https://tourism.jharkhand.gov.in/' },
  'karnataka': { name: 'Karnataka', url: 'https://www.karnatakatourism.org/' },
  'kerala': { name: 'Kerala', url: 'http://www.keralatourism.org' },
  'lakshadweep': { name: 'Lakshadweep', url: 'https://www.lakshadweeptourism.com/' },
  'madhya pradesh': { name: 'Madhya Pradesh', url: 'http://www.mptourism.com' },
  'maharashtra': { name: 'Maharashtra', url: 'http://www.maharashtratourism.gov.in/' },
  'manipur': { name: 'Manipur', url: 'http://www.manipurtourism.gov.in/' },
  'meghalaya': { name: 'Meghalaya', url: 'https://www.meghalayatourism.in/' },
  'mizoram': { name: 'Mizoram', url: 'https://tourism.mizoram.gov.in' },
  'nagaland': { name: 'Nagaland', url: 'http://tourismnagaland.com/' },
  'delhi': { name: 'Delhi', url: 'http://www.delhitourism.gov.in' },
  'odisha': { name: 'Odisha', url: 'http://www.odishatourism.gov.in' },
  'puducherry': { name: 'Puducherry', url: 'http://www.pondytourism.in/' },
  'punjab': { name: 'Punjab', url: 'https://punjabtourism.punjab.gov.in/' },
  'rajasthan': { name: 'Rajasthan', url: 'http://www.tourism.rajasthan.gov.in/' },
  'sikkim': { name: 'Sikkim', url: 'http://www.sikkimtourism.gov.in/' },
  'tamil nadu': { name: 'Tamil Nadu', url: 'http://www.tamilnadutourism.org' },
  'telangana': { name: 'Telangana', url: 'https://www.telanganatourism.gov.in/' },
  'tripura': { name: 'Tripura', url: 'http://tripuratourism.gov.in' },
  'uttar pradesh': { name: 'Uttar Pradesh', url: 'http://www.uptourism.gov.in' },
  'uttarakhand': { name: 'Uttarakhand', url: 'http://uttarakhandtourism.gov.in/' },
  'west bengal': { name: 'West Bengal', url: 'https://www.wbtourism.gov.in/' },
};

// ─── CITY → STATE MAPPING ─────────────────────────────────────────────────
// Comprehensive mapping of popular tourist destinations to their states.
// Falls back to GeoService geocode (state field) for unlisted cities.

export const CITY_STATE_MAP: Record<string, string> = {
  // Andaman & Nicobar
  'port blair': 'andaman & nicobar', 'havelock': 'andaman & nicobar', 'neil island': 'andaman & nicobar',

  // Andhra Pradesh
  'visakhapatnam': 'andhra pradesh', 'vizag': 'andhra pradesh', 'tirupati': 'andhra pradesh',
  'vijayawada': 'andhra pradesh', 'amaravati': 'andhra pradesh', 'araku valley': 'andhra pradesh',
  'srisailam': 'andhra pradesh', 'guntur': 'andhra pradesh', 'nellore': 'andhra pradesh',
  'kurnool': 'andhra pradesh', 'rajahmundry': 'andhra pradesh', 'kakinada': 'andhra pradesh',

  // Arunachal Pradesh
  'tawang': 'arunachal pradesh', 'ziro': 'arunachal pradesh', 'itanagar': 'arunachal pradesh',
  'bomdila': 'arunachal pradesh', 'dirang': 'arunachal pradesh', 'pasighat': 'arunachal pradesh',

  // Assam
  'guwahati': 'assam', 'kaziranga': 'assam', 'majuli': 'assam', 'jorhat': 'assam',
  'tezpur': 'assam', 'silchar': 'assam', 'dibrugarh': 'assam', 'sivasagar': 'assam',

  // Bihar
  'patna': 'bihar', 'bodh gaya': 'bihar', 'rajgir': 'bihar', 'nalanda': 'bihar',
  'vaishali': 'bihar', 'gaya': 'bihar', 'muzaffarpur': 'bihar',

  // Chandigarh
  'chandigarh': 'chandigarh',

  // Chhattisgarh
  'raipur': 'chhattisgarh', 'jagdalpur': 'chhattisgarh', 'chitrakote': 'chhattisgarh',
  'barnawapara': 'chhattisgarh', 'bilaspur': 'chhattisgarh',

  // Delhi / NCR
  'delhi': 'delhi', 'new delhi': 'delhi', 'old delhi': 'delhi', 'noida': 'delhi',
  'gurgaon': 'haryana', 'gurugram': 'haryana', 'faridabad': 'haryana',

  // Goa
  'goa': 'goa', 'panaji': 'goa', 'panjim': 'goa', 'margao': 'goa', 'vasco': 'goa',
  'calangute': 'goa', 'baga': 'goa', 'anjuna': 'goa', 'arambol': 'goa', 'palolem': 'goa',
  'vagator': 'goa', 'candolim': 'goa', 'old goa': 'goa', 'mapusa': 'goa',

  // Gujarat
  'ahmedabad': 'gujarat', 'gandhinagar': 'gujarat', 'vadodara': 'gujarat',
  'surat': 'gujarat', 'rajkot': 'gujarat', 'kutch': 'gujarat', 'rann of kutch': 'gujarat',
  'somnath': 'gujarat', 'dwarka': 'gujarat', 'gir': 'gujarat', 'junagadh': 'gujarat',
  'bhuj': 'gujarat', 'diu': 'gujarat', 'saputara': 'gujarat', 'statue of unity': 'gujarat',

  // Haryana
  'kurukshetra': 'haryana', 'karnal': 'haryana', 'panchkula': 'haryana',

  // Himachal Pradesh
  'shimla': 'himachal pradesh', 'manali': 'himachal pradesh', 'dharamshala': 'himachal pradesh',
  'mcleodganj': 'himachal pradesh', 'dalhousie': 'himachal pradesh', 'kasol': 'himachal pradesh',
  'kullu': 'himachal pradesh', 'spiti': 'himachal pradesh', 'kaza': 'himachal pradesh',
  'bir billing': 'himachal pradesh', 'chamba': 'himachal pradesh', 'khajjiar': 'himachal pradesh',
  'kinnaur': 'himachal pradesh', 'solang valley': 'himachal pradesh',

  // Jammu & Kashmir
  'srinagar': 'jammu and kashmir', 'gulmarg': 'jammu and kashmir', 'pahalgam': 'jammu and kashmir',
  'sonmarg': 'jammu and kashmir', 'jammu': 'jammu and kashmir', 'vaishno devi': 'jammu and kashmir',
  'dal lake': 'jammu and kashmir', 'patnitop': 'jammu and kashmir',

  // Ladakh
  'leh': 'ladakh', 'ladakh': 'ladakh', 'pangong': 'ladakh', 'nubra valley': 'ladakh',
  'kargil': 'ladakh', 'zanskar': 'ladakh', 'tso moriri': 'ladakh',

  // Jharkhand
  'ranchi': 'jharkhand', 'jamshedpur': 'jharkhand', 'deoghar': 'jharkhand',
  'netarhat': 'jharkhand', 'betla': 'jharkhand',

  // Karnataka
  'bangalore': 'karnataka', 'bengaluru': 'karnataka', 'mysore': 'karnataka',
  'mysuru': 'karnataka', 'hampi': 'karnataka', 'coorg': 'karnataka',
  'mangalore': 'karnataka', 'mangaluru': 'karnataka', 'udupi': 'karnataka',
  'gokarna': 'karnataka', 'badami': 'karnataka', 'chikmagalur': 'karnataka',
  'hubli': 'karnataka', 'aihole': 'karnataka', 'pattadakal': 'karnataka',
  'kodagu': 'karnataka', 'bandipur': 'karnataka', 'kabini': 'karnataka',

  // Kerala
  'kochi': 'kerala', 'cochin': 'kerala', 'munnar': 'kerala', 'alleppey': 'kerala',
  'alappuzha': 'kerala', 'thiruvananthapuram': 'kerala', 'trivandrum': 'kerala',
  'kovalam': 'kerala', 'varkala': 'kerala', 'kumarakom': 'kerala',
  'thekkady': 'kerala', 'wayanad': 'kerala', 'fort kochi': 'kerala',
  'periyar': 'kerala', 'kozhikode': 'kerala', 'calicut': 'kerala',
  'bekal': 'kerala', 'vagamon': 'kerala', 'athirappilly': 'kerala',

  // Lakshadweep
  'lakshadweep': 'lakshadweep', 'kavaratti': 'lakshadweep', 'agatti': 'lakshadweep',

  // Madhya Pradesh
  'bhopal': 'madhya pradesh', 'indore': 'madhya pradesh', 'khajuraho': 'madhya pradesh',
  'ujjain': 'madhya pradesh', 'sanchi': 'madhya pradesh', 'orchha': 'madhya pradesh',
  'gwalior': 'madhya pradesh', 'jabalpur': 'madhya pradesh', 'pachmarhi': 'madhya pradesh',
  'kanha': 'madhya pradesh', 'bandhavgarh': 'madhya pradesh', 'mandu': 'madhya pradesh',
  'omkareshwar': 'madhya pradesh', 'maheshwar': 'madhya pradesh',

  // Maharashtra
  'mumbai': 'maharashtra', 'pune': 'maharashtra', 'nagpur': 'maharashtra',
  'aurangabad': 'maharashtra', 'nashik': 'maharashtra', 'lonavala': 'maharashtra',
  'mahabaleshwar': 'maharashtra', 'shirdi': 'maharashtra', 'ajanta': 'maharashtra',
  'ellora': 'maharashtra', 'alibaug': 'maharashtra', 'kolhapur': 'maharashtra',
  'matheran': 'maharashtra', 'lavasa': 'maharashtra', 'panchgani': 'maharashtra',
  'ratnagiri': 'maharashtra', 'tarkarli': 'maharashtra', 'ganpatipule': 'maharashtra',

  // Manipur
  'imphal': 'manipur', 'loktak lake': 'manipur',

  // Meghalaya
  'shillong': 'meghalaya', 'cherrapunji': 'meghalaya', 'dawki': 'meghalaya',
  'mawlynnong': 'meghalaya', 'sohra': 'meghalaya',

  // Mizoram
  'aizawl': 'mizoram',

  // Nagaland
  'kohima': 'nagaland', 'dimapur': 'nagaland', 'mon': 'nagaland',

  // Odisha
  'bhubaneswar': 'odisha', 'puri': 'odisha', 'konark': 'odisha',
  'chilika': 'odisha', 'cuttack': 'odisha', 'gopalpur': 'odisha',

  // Puducherry
  'puducherry': 'puducherry', 'pondicherry': 'puducherry', 'auroville': 'puducherry',

  // Punjab
  'amritsar': 'punjab', 'ludhiana': 'punjab', 'jalandhar': 'punjab',
  'patiala': 'punjab', 'bathinda': 'punjab',

  // Rajasthan
  'jaipur': 'rajasthan', 'udaipur': 'rajasthan', 'jodhpur': 'rajasthan',
  'jaisalmer': 'rajasthan', 'pushkar': 'rajasthan', 'ajmer': 'rajasthan',
  'bikaner': 'rajasthan', 'mount abu': 'rajasthan', 'ranthambore': 'rajasthan',
  'chittorgarh': 'rajasthan', 'bundi': 'rajasthan', 'kumbhalgarh': 'rajasthan',
  'alwar': 'rajasthan', 'bharatpur': 'rajasthan', 'sawai madhopur': 'rajasthan',
  'mandawa': 'rajasthan',

  // Sikkim
  'gangtok': 'sikkim', 'pelling': 'sikkim', 'ravangla': 'sikkim',
  'lachung': 'sikkim', 'namchi': 'sikkim', 'gurudongmar': 'sikkim',
  'tsomgo lake': 'sikkim', 'yuksom': 'sikkim',

  // Tamil Nadu
  'chennai': 'tamil nadu', 'madurai': 'tamil nadu', 'ooty': 'tamil nadu',
  'kodaikanal': 'tamil nadu', 'mahabalipuram': 'tamil nadu', 'kanchipuram': 'tamil nadu',
  'rameswaram': 'tamil nadu', 'thanjavur': 'tamil nadu', 'coimbatore': 'tamil nadu',
  'trichy': 'tamil nadu', 'tiruchirappalli': 'tamil nadu',
  'yelagiri': 'tamil nadu', 'yercaud': 'tamil nadu', 'coonoor': 'tamil nadu',
  'kanyakumari': 'tamil nadu', 'dhanushkodi': 'tamil nadu', 'hogenakkal': 'tamil nadu',
  'tambaram': 'tamil nadu', 'velankanni': 'tamil nadu',

  // Telangana
  'hyderabad': 'telangana', 'secunderabad': 'telangana', 'warangal': 'telangana',
  'ramoji film city': 'telangana', 'nagarjuna sagar': 'telangana',

  // Tripura
  'agartala': 'tripura', 'unakoti': 'tripura',

  // Uttar Pradesh
  'agra': 'uttar pradesh', 'varanasi': 'uttar pradesh', 'lucknow': 'uttar pradesh',
  'mathura': 'uttar pradesh', 'vrindavan': 'uttar pradesh', 'allahabad': 'uttar pradesh',
  'prayagraj': 'uttar pradesh', 'ayodhya': 'uttar pradesh', 'fatehpur sikri': 'uttar pradesh',
  'sarnath': 'uttar pradesh', 'chitrakoot': 'uttar pradesh',

  // Uttarakhand
  'dehradun': 'uttarakhand', 'rishikesh': 'uttarakhand', 'haridwar': 'uttarakhand',
  'mussoorie': 'uttarakhand', 'nainital': 'uttarakhand', 'auli': 'uttarakhand',
  'jim corbett': 'uttarakhand', 'valley of flowers': 'uttarakhand', 'chopta': 'uttarakhand',
  'kedarnath': 'uttarakhand', 'badrinath': 'uttarakhand', 'almora': 'uttarakhand',
  'ranikhet': 'uttarakhand', 'lansdowne': 'uttarakhand', 'mukteshwar': 'uttarakhand',
  'binsar': 'uttarakhand', 'tungnath': 'uttarakhand',

  // West Bengal
  'kolkata': 'west bengal', 'darjeeling': 'west bengal', 'siliguri': 'west bengal',
  'kalimpong': 'west bengal', 'sundarbans': 'west bengal', 'digha': 'west bengal',
  'shantiniketan': 'west bengal', 'murshidabad': 'west bengal', 'bishnupur': 'west bengal',
};

// ─── ALERT KEYWORDS ───────────────────────────────────────────────────────
// Keywords scraped from tourism sites that indicate actionable intelligence

export const ALERT_KEYWORDS = [
  'closed', 'closure', 'shut down', 'shutdown',
  'festival', 'celebration', 'mela', 'utsav', 'carnival',
  'permit', 'pass required', 'inner line permit', 'restricted',
  'traffic', 'road block', 'roadblock', 'diversion',
  'monsoon', 'flood', 'landslide', 'cyclone', 'storm',
  'heavy rain', 'snowfall', 'avalanche',
  'restricted area', 'no entry', 'prohibited',
  'holiday', 'public holiday', 'bandh', 'strike',
  'construction', 'renovation', 'under repair',
  'warning', 'advisory', 'alert', 'caution', 'notice',
  'crowd', 'rush', 'peak season', 'tourist rush',
  'entry fee', 'timings changed', 'new timings',
  'eco-sensitive', 'wildlife sanctuary', 'national park',
  'booking required', 'advance booking', 'reservation required',
];

// ─── POI SCRAPING KEYWORDS ────────────────────────────────────────────────
// Text patterns on tourism sites that indicate official POI listings

export const POI_SECTION_KEYWORDS = [
  'places to visit', 'tourist places', 'top attractions',
  'destinations', 'places of interest', 'must visit',
  'heritage sites', 'monuments', 'temples', 'beaches',
  'hill stations', 'wildlife', 'national parks',
  'adventure', 'pilgrimage', 'religious places',
  'forts', 'palaces', 'museums', 'gardens', 'lakes',
];

// ─── CATEGORY CLASSIFICATION ──────────────────────────────────────────────

export function classifyPoiCategory(text: string): string {
  const lower = text.toLowerCase();
  if (/temple|mandir|shrine|church|mosque|gurudwara|pilgrimage|religious/.test(lower)) return 'Religious';
  if (/beach|coast|seaside|shore/.test(lower)) return 'Beach';
  if (/fort|palace|haveli|monument|heritage/.test(lower)) return 'Heritage';
  if (/museum|gallery|art/.test(lower)) return 'Museum';
  if (/hill station|viewpoint|valley|mountain|peak/.test(lower)) return 'Nature';
  if (/wildlife|sanctuary|national park|tiger|bird/.test(lower)) return 'Wildlife';
  if (/lake|waterfall|river|dam|backwater/.test(lower)) return 'Water Body';
  if (/garden|park|botanical/.test(lower)) return 'Park';
  if (/adventure|trek|rafting|paragliding|camping/.test(lower)) return 'Adventure';
  if (/market|bazaar|shopping|mall/.test(lower)) return 'Shopping';
  return 'Sightseeing';
}

// ─── CROWD IMPACT SCORING ─────────────────────────────────────────────────

export function assessCrowdImpact(alertText: string): { level: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'; score: number } {
  const lower = alertText.toLowerCase();
  if (/flood|cyclone|landslide|avalanche|storm|bandh|strike/.test(lower))
    return { level: 'EXTREME', score: 50 };
  if (/festival|mela|carnival|rush|peak season|holiday|celebration/.test(lower))
    return { level: 'HIGH', score: 25 };
  if (/crowd|traffic|diversion|road block|construction/.test(lower))
    return { level: 'MEDIUM', score: 15 };
  if (/closed|restricted|permit|renovation|repair|timings/.test(lower))
    return { level: 'LOW', score: 5 };
  return { level: 'LOW', score: 0 };
}
