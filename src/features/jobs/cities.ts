// Canonical list of Pakistan's major cities for the job form's city gate.
// Sourcing the city from a fixed list (rather than a free-text box) keeps
// the eligibility gate drawn from the SAME vocabulary the /apply flow uses
// to capture a candidate's city — so a job's required city and an
// applicant's stored city actually match instead of drifting on spelling.
// Sorted alphabetically so the native <Select> typeahead (press a letter to
// jump) lands on the right entry quickly. Parenthetical qualifiers like
// "Mingora (Swat)" are intentional.
export const PAKISTAN_CITIES = [
  "Abbottabad",
  "Attock",
  "Bahawalnagar",
  "Bahawalpur",
  "Bannu",
  "Burewala",
  "Chakwal",
  "Chiniot",
  "Dera Ghazi Khan",
  "Dera Ismail Khan",
  "Faisalabad",
  "Gilgit",
  "Gujranwala",
  "Gujrat",
  "Gwadar",
  "Hafizabad",
  "Haripur",
  "Hyderabad",
  "Islamabad",
  "Jacobabad",
  "Jhang",
  "Jhelum",
  "Karachi",
  "Kasur",
  "Khairpur",
  "Khanewal",
  "Khushab",
  "Khuzdar",
  "Kohat",
  "Kotri",
  "Lahore",
  "Larkana",
  "Mandi Bahauddin",
  "Mansehra",
  "Mardan",
  "Mingora (Swat)",
  "Mirpur (AJK)",
  "Multan",
  "Muzaffarabad",
  "Muzaffargarh",
  "Nawabshah",
  "Nowshera",
  "Okara",
  "Peshawar",
  "Quetta",
  "Rahim Yar Khan",
  "Rawalpindi",
  "Sadiqabad",
  "Sahiwal",
  "Sargodha",
  "Sheikhupura",
  "Sialkot",
  "Sukkur",
  "Swabi",
  "Tando Adam",
  "Turbat",
  "Vehari",
  "Wah Cantonment",
] as const;

// Sentinel for the "Any city" option — the job has no city gate at all. It
// maps to an empty `eligibility.city`. Radix Select forbids empty item
// values, so the "no requirement" choice needs a real, non-empty sentinel
// that can never collide with a city name.
export const ANY_CITY_VALUE = "__any__";

// Sentinel for the "Other" option. When chosen the field switches to a free
// text input; this value is never submitted as the city.
export const OTHER_CITY_VALUE = "__other__";

// Fast membership lookup so the field can tell a known city from a custom
// ("Other") one without scanning the array on every render.
export const PAKISTAN_CITY_SET: ReadonlySet<string> = new Set(PAKISTAN_CITIES);
