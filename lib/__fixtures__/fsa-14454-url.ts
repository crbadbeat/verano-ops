// The saved configurator link behind Final Sales Agreement #14454: a GX10 grill
// island (double, two cocktail stations) beside a Maui 10 bar island, under a
// St. Barth pergola. Shared by the URL and PDF suites so the two input paths can
// be asserted to agree.
export const FSA_14454_URL =
  "https://veranodirect.com/configurator_1/?ar=false&ISLAND=7%2Cdouble" +
  "&BAR_ISLAND=7%2Chide%2Cparallel&COMBO=5&SHADE=-1&GRILLS=0%2C3%3B1%2C3" +
  "&STAINLESS=0%2C2%2C0%3B1%2C4%2C0%3B5%2C4%2C1%3B6%2C4%2C1&TOP=&FOOTREST=0%2C6%2C1" +
  "&STONE=1&SIDING=0&HAPPY=2%2C4%2C7%2C10&PATIOS=&STOOLS=8%2C7" +
  "&ACCESS_DOORS=0%2C0%2C0%3B1%2C0%2C0";

/** What both paths must produce, confirmed by the product owner. */
export const FSA_14454_SKUS = {
  grillBase: "GX10-D-NN-2-1-1-0-N-N-N-CA", // a "Special" — not stocked
  grillTop: "VOLGX10DNNNNN", // cut from VOLGX10BLANK, which IS stocked
  barBase: "MA10-N-NN-0-2-0-0-L-Y-Y-CA", // a stocked Parent
  barTop: "VOLMA10NNNNNN", // a stocked top
};
