const notice = (msg) => new Notice(msg, 5000);
const log = (msg) => console.log(msg);

const API_URL = "https://api.igdb.com/v4/games";
const AUTH_URL = "https://id.twitch.tv/oauth2/token";
const GRANT_TYPE = "client_credentials";

const API_CLIENT_ID_OPTION = "IGDB API Client ID";
const API_CLIENT_SECRET_OPTION = "IGDB API Client secret";

var userData = { igdbToken: "" };
var AUTH_TOKEN;

module.exports = {
  entry: start,
  settings: {
    name: "Videogames Script",
    author: "Elaws",
    options: {
      [API_CLIENT_ID_OPTION]: {
        type: "text",
        defaultValue: "",
        placeholder: "IGDB API Client ID",
      },
      [API_CLIENT_SECRET_OPTION]: {
        type: "text",
        defaultValue: "",
        placeholder: "IGDB API Client secret",
      },
    },
  },
};

let QuickAdd;
let Settings;
let savePath;

async function start(params, settings) {
  QuickAdd = params;
  Settings = settings;

  var relativePath = QuickAdd.app.vault.configDir;
  savePath = QuickAdd.obsidian.normalizePath(`${relativePath}/igdbToken.json`);

  await readAuthToken();

  const userInput = await QuickAdd.quickAddApi.inputPrompt("Enter IGDB game name or URL:");
  if (!userInput) {
    notice("No input entered.");
    throw new Error("No input entered.");
  }

  const slug = extractSlugFromUrl(userInput) || slugify(userInput);

  let searchResults = await getBySlug(slug);

  // If no results by slug, fallback to regular search
  if (searchResults.length === 0) {
    searchResults = await getByQuery(userInput);
  }

  const selectedGame = await QuickAdd.quickAddApi.suggester(
    searchResults.map(formatTitleForSuggestion),
    searchResults
  );

  if (!selectedGame) {
    notice("No choice selected.");
    throw new Error("No choice selected.");
  }

  let developer = selectedGame.involved_companies?.find(el => el.developer);

  QuickAdd.variables = {
    ...selectedGame,
    fileName: replaceIllegalFileNameCharactersInString(selectedGame.name),
    titleSanitized: replaceIllegalFileNameCharactersInString(selectedGame.name),
    genresFormatted: Array.isArray(selectedGame.genres) ? formatList(selectedGame.genres.map(item => item.name)) : "N/A",
    developerName: developer?.company?.name || "N/A",
    developerLogo: developer?.company?.logo?.url ? ("https:" + developer.company.logo.url).replace("thumb", "logo_med") : " ",
    thumbnail: selectedGame.cover?.url ? "https:" + selectedGame.cover.url.replace("thumb", "cover_big") : " ",
    release: selectedGame.first_release_date ? new Date(selectedGame.first_release_date * 1000).getFullYear() : "N/A",
    storylineFormatted: selectedGame.storyline?.trim()
      ? `"${truncateText(selectedGame.storyline.replace(/["\r\n]+/g, " "), 300).replace(/"/g, '\\"')}"`
      : selectedGame.summary?.trim()
        ? `"${truncateText(selectedGame.summary.replace(/["\r\n]+/g, " "), 300).replace(/"/g, '\\"')}"`
        : "Plot not available.",
    rating: safeValue(selectedGame.rating != null ? Math.round(selectedGame.rating) : null),
    platformsFormatted: Array.isArray(selectedGame.platforms)
      ? selectedGame.platforms.map(p => p.name.trim()).join(", ")
      : "N/A",
  };
}

function extractSlugFromUrl(url) {
  const match = url.match(/\/games\/([^\/?#]+)/i);
  return match ? match[1] : null;
}

function slugify(text) {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
}

async function getByQuery(query) {
  const searchResults = await apiGet(`search "${query}"; limit 15;`);

  if (!Array.isArray(searchResults) || searchResults.length === 0) {
    notice("No results found.");
    throw new Error("No results found.");
  }

  return searchResults;
}

async function getBySlug(slug) {
  return await apiGet(`where slug = "${slug}"; limit 1;`);
}

function safeValue(value, fallback = "N/A") {
  return (value != null && value !== "") ? value : fallback;
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + "...";
}

function formatTitleForSuggestion(resultItem) {
  const year = resultItem.first_release_date
    ? new Date(resultItem.first_release_date * 1000).getFullYear()
    : "Unknown";
  return `${resultItem.name} (${year})`;
}

function formatList(list) {
  if (list.length === 0 || list[0] == "N/A") return " ";
  if (list.length === 1) return list[0].trim();
  return list.map(item => item.trim()).join(", ");
}

function replaceIllegalFileNameCharactersInString(string) {
  return string.replace(/[\\,#%&\{\}\/*<>$\":@.]*/g, "");
}

async function readAuthToken() {
  if (await QuickAdd.app.vault.adapter.exists(savePath)) {
    userData = JSON.parse(await QuickAdd.app.vault.adapter.read(savePath));
    AUTH_TOKEN = userData.igdbToken;
  } else {
    await refreshAuthToken();
  }
}

async function refreshAuthToken() {
  const authResults = await getAuthentified();

  if (!authResults.access_token) {
    notice("Auth token refresh failed.");
    throw new Error("Auth token refresh failed.");
  } else {
    AUTH_TOKEN = authResults.access_token;
    userData.igdbToken = authResults.access_token;
    await QuickAdd.app.vault.adapter.write(savePath, JSON.stringify(userData));
  }
}

async function getAuthentified() {
  let finalURL = new URL(AUTH_URL);

  finalURL.searchParams.append("client_id", Settings[API_CLIENT_ID_OPTION]);
  finalURL.searchParams.append("client_secret", Settings[API_CLIENT_SECRET_OPTION]);
  finalURL.searchParams.append("grant_type", GRANT_TYPE);

  const res = await request({
    url: finalURL.href,
    method: 'POST',
    cache: 'no-cache',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  return JSON.parse(res);
}

async function apiGet(igdbQuery) {
  try {
    const res = await request({
      url: API_URL,
      method: 'POST',
      cache: 'no-cache',
      headers: {
        'Client-ID': Settings[API_CLIENT_ID_OPTION],
        'Authorization': "Bearer " + AUTH_TOKEN
      },
      body: `fields name, slug, first_release_date, involved_companies.developer, involved_companies.company.name, involved_companies.company.logo.url, url, cover.url, genres.name, game_modes.name, storyline, summary, rating, platforms.name; ${igdbQuery}`
    });

    const json = JSON.parse(res);
    return Array.isArray(json) ? json : [];
  } catch (error) {
    console.error("API request failed: ", error);
    notice("API request failed. Trying to refresh token...");
    await refreshAuthToken();

    try {
      const retryRes = await request({
        url: API_URL,
        method: 'POST',
        cache: 'no-cache',
        headers: {
          'Client-ID': Settings[API_CLIENT_ID_OPTION],
          'Authorization': "Bearer " + AUTH_TOKEN
        },
			// The understand syntax of request to IGDB API, read the following :
			// https://api-docs.igdb.com/#examples
			// https://api-docs.igdb.com/#game
			// https://api-docs.igdb.com/#expander
        body: `fields name, slug, first_release_date, involved_companies.developer, involved_companies.company.name, involved_companies.company.logo.url, url, cover.url, genres.name, game_modes.name, storyline, summary, rating, platforms.name; ${igdbQuery}`
      });

      const retryJson = JSON.parse(retryRes);
      return Array.isArray(retryJson) ? retryJson : [];
    } catch (retryError) {
      console.error("Retry failed: ", retryError);
      throw new Error("API request failed after retry.");
    }
  }
}
