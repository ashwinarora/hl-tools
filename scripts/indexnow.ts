/**
 * Tells the search engines that take IndexNow (Bing, DuckDuckGo through Bing,
 * Yandex, Seznam, Naver) about every entry page: run it once after a deploy
 * that changes them (`bun run indexnow`). The key is public by design: it
 * is served at `/<key>.txt` to prove the site sent the list. Nothing in the
 * site itself contacts IndexNow.
 */
import { canonicalUrl, PAGES, type PagePath } from "#/lib/pages";
import { SITE_ORIGIN } from "#/lib/site";

const KEY = "a19223903f963874ef395b7633684e0f";

const urlList = (Object.keys(PAGES) as PagePath[]).map(canonicalUrl);
const res = await fetch("https://api.indexnow.org/indexnow", {
	method: "POST",
	headers: { "content-type": "application/json; charset=utf-8" },
	body: JSON.stringify({
		host: new URL(SITE_ORIGIN).host,
		key: KEY,
		keyLocation: `${SITE_ORIGIN}/${KEY}.txt`,
		urlList,
	}),
});
// 200 and 202 both mean the list was taken
console.log(`IndexNow: HTTP ${res.status} for ${urlList.length} pages`);
if (res.status !== 200 && res.status !== 202) {
	console.log(await res.text());
	process.exit(1);
}
