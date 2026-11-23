"use strict";
// The app's ingredient rules, copied from candela core/pricing/ProductMatcher.kt (same order, same
// words). Copy them again when that file changes. Each rule: [food, family, categories, terms, excludes].
const RULES = [
  ["wheat_flour", "kg", ["57"], ["weizenmehl", "mehl"], ["mandel", "kokos", "reis", "mais", "buchweizen", "dinkel", "roggen", "kichererbsen"]],
  ["bread", "kg", ["10", "11"], ["brot", "mischbrot", "schwarzbrot", "vollkornbrot", "bauernbrot"], ["knaeck", "toast", "brotchips", "zwieback"]],
  ["pasta", "kg", ["54"], ["spaghetti", "penne", "fusilli", "nudeln", "spiralen", "farfalle", "maccheroni", "rigatoni", "tagliatelle", "linguine"], ["ramen", "reisnudeln", "glasnudeln", "fadennudeln", "suppe"]],
  ["oats", "kg", ["50", "59"], ["haferflocken"], ["riegel", "muesli"]],
  ["couscous", "kg", ["54", "59", "5A"], ["couscous"], []],
  ["rice", "kg", ["54", "5A"], ["reis", "basmati", "jasmin", "risotto", "langkornreis", "rundkornreis"], ["reiswaffel", "milchreis", "reisnudel", "reisessig", "reismehl", "reispapier", "reisdrink", "sushi"]],
  ["milk", "l", ["34"], ["milch", "vollmilch", "frischmilch", "heumilch", "vollmilch"], ["kokos", "hafer", "soja", "mandel", "reis", "buttermilch", "kondens", "schoko", "kakao", "milchreis", "mix", "kaffee", "eis", "latte", "obers", "acidophilus"]],
  ["butter", "kg", ["32", "34"], ["butter", "teebutter", "suessrahmbutter", "sauerrahmbutter"], ["kraeuter", "knoblauch", "erdnuss", "butterkaese", "schmalz", "buttermilch"]],
  ["cheese", "kg", ["32"], ["gouda", "emmentaler", "edamer", "bergkaese", "parmesan", "parmigiano", "grana", "mozzarella", "cheddar", "tilsiter", "kaese"], ["frischkaese", "streich", "aufstrich", "kaesekrainer", "ofenkaese"]],
  ["cream", "l", ["34", "32"], ["schlagobers", "obers", "sahne", "kochcreme", "kochobers"], ["sauer", "eis", "creme fraiche", "spray"]],
  ["yogurt", "kg", ["34"], ["joghurt", "naturjoghurt", "jogurt"], ["frucht", "erdbeer", "vanille", "pfirsich", "himbeer", "drink", "trink", "schoko", "kirsch", "heidel", "mango", "marille", "zitrone", "stracciatella", "muesli", "kokos", "griess"]],
  ["egg", "unit", ["30"], ["eier", "ei"], ["gekocht", "gefaerbt", "salat", "likoer"]],
  ["chicken", "kg", ["00", "F0", "F1", "F5"], ["hendl", "huhn", "haehnchen", "huehner", "huehnerfilet", "huehnerbrust", "hendlbrust", "hendlfilet", "putenbrust"], ["wurst", "schinken", "nuggets", "paniert", "backhendl"]],
  ["beef", "kg", ["F1", "F3"], ["rindfleisch", "rind", "rinderfaschiertes", "faschiertes", "rindsschnitzel", "beiried", "rumpsteak", "tafelspitz", "gulaschfleisch"], ["schwein", "hendl", "gemischt"]],
  ["pork", "kg", ["F2", "F1", "A8"], ["schwein", "schweins", "schweinefleisch", "karree", "schopf", "bauchfleisch", "speck"], ["rind", "hendl"]],
  ["cured_ham", "kg", ["A6", "AA", "A0"], ["schinken", "beinschinken", "prosciutto", "rohschinken"], ["lachsschinken", "krenschinken", "huehnerschinken", "puten"]],
  ["salmon", "kg", ["C0", "C2", "41"], ["lachs", "lachsfilet", "raeucherlachs"], ["salat", "creme", "aufstrich", "lachsschinken"]],
  ["tuna", "kg", ["53", "5A", "D1"], ["thunfisch"], ["salat", "creme", "aufstrich", "pizza"]],
  ["cod", "kg", ["41", "C0"], ["dorsch", "kabeljau", "seelachs", "seehecht", "hecht", "fischfilet"], ["paniert", "knusper", "staebchen", "backfisch"]],
  ["shrimp", "kg", ["41", "C1"], ["garnelen", "shrimps", "crevetten", "gambas"], ["salat", "cocktail"]],
  ["mussel", "kg", ["41", "C1", "53"], ["miesmuscheln", "muscheln", "venusmuscheln"], []],
  ["squid", "kg", ["41", "C1", "53"], ["tintenfisch", "calamari", "oktopus", "pulpo", "sepia"], ["paniert"]],
  ["tofu", "kg", ["100"], ["tofu"], ["wurst"]],
  ["potato", "kg", ["00", "01"], ["kartoffeln", "erdaepfel", "kartoffel", "erdapfel"], ["puffer", "pommes", "chips", "knoedel", "salat", "pueree", "sticks", "roesti", "kroketten", "wedges"]],
  ["onion", "kg", ["00", "01"], ["zwiebel", "zwiebeln", "speisezwiebel"], ["roest", "fruehlings", "jung", "lauch"]],
  ["garlic", "kg", ["00", "01", "03"], ["knoblauch"], ["paste", "granulat", "creme", "oel", "sauce", "butter"]],
  ["tomato", "kg", ["00", "01", "02"], ["tomaten", "paradeiser", "rispentomaten", "cherrytomaten", "strauchtomaten", "cocktailtomaten"], ["getrocknet", "sauce", "mark", "passiert"]],
  ["carrot", "kg", ["00", "01"], ["karotten", "karotte", "moehren"], ["saft", "sticks"]],
  ["bell_pepper", "kg", ["00", "01"], ["paprika", "spitzpaprika"], ["pulver", "chips", "gewuerz", "creme", "mark"]],
  ["zucchini", "kg", ["00", "01"], ["zucchini", "kuerbis"], ["kerne", "kernoel", "suppe"]],
  ["eggplant", "kg", ["00", "01"], ["melanzani", "aubergine", "auberginen"], ["creme", "aufstrich"]],
  ["spinach", "kg", ["00", "01", "02", "40"], ["spinat", "blattspinat", "babyspinat", "spargel"], ["creme", "rahmspinat", "suppe"]],
  ["broccoli", "kg", ["00", "01", "40"], ["brokkoli", "broccoli"], ["buchweizen", "mix"]],
  ["mushroom", "kg", ["00", "01", "04"], ["champignons", "champignon", "pilze", "austernpilze", "egerlinge"], ["sauce", "suppe", "creme"]],
  ["celery", "kg", ["00", "01"], ["sellerie", "stangensellerie", "staudensellerie"], ["salz", "saft"]],
  ["lentils", "kg", ["54", "53", "59", "5A"], ["linsen", "berglinsen", "rote linsen"], ["chips", "suppe", "pasta", "nudeln", "eintopf"]],
  ["chickpeas", "kg", ["53", "54", "59", "5A"], ["kichererbsen"], ["chips", "mehl", "nudeln", "pasta", "snack", "hummus"]],
  ["beans", "kg", ["53", "54", "40"], ["bohnen", "kidneybohnen", "weisse bohnen", "kidney"], ["kaffee", "gulasch", "chips", "fisolen", "edamame", "espresso"]],
  ["avocado", "unit", ["00"], ["avocado", "avocados"], ["creme", "oel"]],
  ["lemon", "kg", ["00"], ["zitronen", "zitrone"], ["saft", "limonade", "tee", "gras", "melisse", "pfeffer"]],
  ["apple", "kg", ["00"], ["aepfel", "apfel"], ["saft", "chips", "mus", "essig", "strudel", "kuchen", "tasche", "ring"]],
  ["banana", "kg", ["00"], ["bananen", "banane"], ["chips", "bread", "brot"]],
  ["strawberry", "kg", ["00", "02", "40"], ["erdbeeren", "erdbeere"], ["konfituere", "joghurt"]],
  ["orange", "kg", ["00"], ["orangen", "orange", "blutorangen"], ["saft", "marmelade", "limonade", "schoko"]],
  ["almond", "kg", ["5D", "05", "58"], ["mandeln", "mandel", "mandelkerne"], ["milch", "drink", "mus", "schoko", "riegel", "marzipan", "creme", "gebrannt"]],
  ["walnut", "kg", ["5D", "05", "58"], ["walnuesse", "walnusskerne", "walnuss", "walnusskern"], ["oel", "riegel", "muhammara"]],
  ["hazelnut", "kg", ["5D", "05", "58"], ["haselnuesse", "haselnusskerne", "haselnuss"], ["creme", "schoko", "riegel", "aufstrich", "milch", "drink", "waffel"]],
  ["peanut", "kg", ["5D", "05", "51", "58"], ["erdnuesse", "erdnuss", "erdnussbutter", "erdnusscreme"], ["riegel", "flips", "locken", "schoko"]],
  ["olive_oil", "l", ["5C"], ["olivenoel"], []],
  ["sunflower_oil", "l", ["5C"], ["sonnenblumenoel", "rapsoel", "pflanzenoel"], []],
  ["soy_sauce", "l", ["5A", "5C", "53"], ["sojasauce", "sojasosse", "soja sauce", "shoyu"], []],
  ["mustard", "kg", ["5C", "53"], ["senf", "estragonsenf", "dijonsenf"], ["saat", "koerner", "sauce"]],
  ["sesame", "kg", ["5A", "58", "59", "5D", "5C"], ["sesam", "tahin", "tahini"], ["oel", "riegel", "chips", "sticks"]],
  ["white_wine", "l", ["25"], ["veltliner", "weisswein", "chardonnay", "riesling", "welschriesling", "sauvignon", "rotwein", "zweigelt"], ["spritzer", "sekt", "alkoholfrei", "frizzante"]],
  ["vinegar", "l", ["53", "5C", "5A"], ["essig", "balsamico", "apfelessig", "weinessig", "aceto"], ["gurken", "creme", "reduktion", "crema"]],
  ["sugar", "kg", ["52"], ["zucker", "kristallzucker", "staubzucker", "feinkristallzucker", "rohrzucker"], ["vanille", "wuerfel", "kandis", "sirup", "gelier", "espresso", "hagel", "birken", "xylit", "erythrit"]],
  ["honey", "kg", ["51"], ["honig", "bluetenhonig", "waldhonig", "akazienhonig"], ["senf", "met"]],
  ["salt", "kg", ["5B"], ["salz", "meersalz", "speisesalz", "steinsalz", "tafelsalz", "kristallsalz"], []],
  ["black_pepper", "kg", ["5C"], ["pfeffer", "schwarzer pfeffer", "pfefferkoerner"], ["cayenne", "chili", "zitronen", "muehle leer", "beisser", "salami", "gewuerzmischung"]],
  ["dark_chocolate", "kg", ["58", "35", "5D"], ["zartbitter", "bitterschokolade", "kochschokolade", "backschokolade", "edelbitter"], ["riegel", "glasur", "keks", "drops"]],
].map(([food, family, categories, terms, excludes]) => ({ food, family, categories, terms, excludes }));

const FOLD = { "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "á": "a", "à": "a", "â": "a", "é": "e", "è": "e", "ê": "e",
  "í": "i", "ì": "i", "î": "i", "ó": "o", "ò": "o", "ô": "o", "ú": "u", "ù": "u", "û": "u", "ñ": "n" };

/** Lower case, ä → ae, ö → oe, ü → ue, ß → ss, as ProductMatcher.fold. */
const fold = (text) => [...String(text).toLowerCase()].map((c) => FOLD[c] ?? c).join("");

const FAMILY = { g: "kg", ml: "l" };

/** The first rule whose words match [name] for a product sold by [unit] (g, ml or stk), as the app does it. */
function foodRule(name, unit) {
  const folded = fold(name);
  const words = folded.split(/[^a-z0-9]+/).filter(Boolean);
  const family = FAMILY[unit] || "unit";
  return RULES.find((r) => r.family === family && !r.excludes.some((e) => folded.includes(e)) &&
    r.terms.some((t) => (t.includes(" ") ? folded.includes(t) : words.some((w) => w === t || (t.length >= 4 && w.endsWith(t)))))) || null;
}

module.exports = { RULES, fold, foodRule };
