/**
 * Pakistan's major cities for the bulk CV import review dropdown.
 *
 * A VERBATIM MIRROR of the apply portal's
 * `apply/form/apply.cities.ts`. The two funnels feed the same
 * `candidates.city` field, so a candidate imported from a CV and one who
 * applied through the portal must be able to produce the same string, or the
 * job's city gate and every location segment sees two spellings of one city.
 *
 * Copied rather than imported because these are separate packages with
 * separate `node_modules` and no workspace linking them. If you add a city,
 * add it to BOTH files.
 *
 * Sorted alphabetically so the native select typeahead (press a letter to
 * jump) lands on the right entry quickly. Keep it free of em/en dashes per the
 * repo-wide UI rule; parenthetical qualifiers like "Mingora (Swat)" are fine.
 */
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
] as const

/**
 * Sentinel for the "Other" option. Deliberately not a real city name so it can
 * never collide with a list entry, and never submitted as the city itself.
 *
 * It earns its place here more than on the apply form: a CV is parsed by a
 * model, so the extracted city can be anything ("Lahore, Pakistan", a town not
 * on the list, a misread). Without an escape hatch those rows would be
 * unimportable.
 */
export const OTHER_CITY_VALUE = "__other__"

/** Fast membership test, so a row can tell a known city from a custom one. */
export const PAKISTAN_CITY_SET: ReadonlySet<string> = new Set(PAKISTAN_CITIES)
