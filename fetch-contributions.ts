import { z } from "zod";

const tokenFile = ".env";
const tokenEnv = ["CONTRIB_TOKEN", "GITHUB_TOKEN"];
const outFile = "contributions.json";
const previewFile = "preview.svg";
const login = Deno.env.get("CONTRIB_LOGIN") ?? "";

const previewWeeks = 52;
const previewCell = 14;
const previewGap = 2;
const previewCellRadius = 2;
const previewCornerRadius = 24;
const previewColor1 = "#11262D";
const previewColor2 = "#DFFF00";

const levels = {
    NONE: 0,
    FIRST_QUARTILE: 1,
    SECOND_QUARTILE: 2,
    THIRD_QUARTILE: 3,
    FOURTH_QUARTILE: 4,
} as const;

const Calendar = z.object({
    login: z.string(),
    contributionsCollection: z.object({
        contributionCalendar: z.object({
            totalContributions: z.number(),
            weeks: z.array(
                z.object({
                    contributionDays: z.array(
                        z.object({
                            date: z.string(),
                            weekday: z.number().int().min(0).max(6),
                            contributionCount: z.number().int(),
                            contributionLevel: z.enum([
                                "NONE",
                                "FIRST_QUARTILE",
                                "SECOND_QUARTILE",
                                "THIRD_QUARTILE",
                                "FOURTH_QUARTILE",
                            ]),
                        }),
                    ),
                }),
            ),
        }),
    }),
});

const Response = z.object({
    data: z.object({ user: Calendar.nullish(), viewer: Calendar.nullish() }).nullish(),
    errors: z.array(z.object({ message: z.string() })).optional(),
});

const fields =
    `login contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date weekday contributionCount contributionLevel } } } }`;
const query = login ? `query($login: String!) { user(login: $login) { ${fields} } }` : `query { viewer { ${fields} } }`;

async function readToken(): Promise<string> {
    for (const name of tokenEnv) {
        const value = Deno.env.get(name);
        if (value) return value.trim();
    }
    try {
        const raw = (await Deno.readTextFile(tokenFile)).trim();
        return raw.match(/GITHUB_TOKEN\s*=\s*(\S+)/)?.[1] ?? raw;
    } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
            console.error(`No token: set ${tokenEnv.join(" or ")} or create ${tokenFile}`);
            Deno.exit(1);
        }
        throw err;
    }
}

const token = await readToken();

const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: login ? { login } : {} }),
});
if (!res.ok) {
    console.error(`GitHub API ${res.status}: ${await res.text()}`);
    Deno.exit(1);
}

const parsed = Response.parse(await res.json());
if (parsed.errors?.length) {
    console.error(`GitHub API errors: ${parsed.errors.map((e) => e.message).join("; ")}`);
    Deno.exit(1);
}
const user = parsed.data?.user ?? parsed.data?.viewer;
if (!user) {
    console.error(`No user found for ${login || "token owner"}`);
    Deno.exit(1);
}

const calendar = user.contributionsCollection.contributionCalendar;
const out = {
    login: user.login,
    generatedAt: new Date().toISOString(),
    total: calendar.totalContributions,
    weeks: calendar.weeks.map((week) =>
        week.contributionDays.map((day) => ({
            date: day.date,
            weekday: day.weekday,
            count: day.contributionCount,
            level: levels[day.contributionLevel],
        }))
    ),
};

function mix(a: string, b: string, t: number): string {
    const ca = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const cb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    const [r, g, bl] = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
    return `rgb(${r}, ${g}, ${bl})`;
}

function buildPreview(weeks: typeof out.weeks): string {
    const recent = weeks.slice(-previewWeeks);
    const offset = previewWeeks - recent.length;
    const step = previewCell + previewGap;
    const width = previewWeeks * step - previewGap;
    const height = 7 * step - previewGap;
    const rects = recent.flatMap((week, w) =>
        week.map((day) => {
            const x = (w + offset) * step;
            const y = day.weekday * step;
            const fill = mix(previewColor1, previewColor2, day.level / 4);
            return `<rect x="${x}" y="${y}" width="${previewCell}" height="${previewCell}" rx="${previewCellRadius}" fill="${fill}"><title>${day.date}: ${day.count}</title></rect>`;
        })
    );
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        `<clipPath id="c"><rect width="${width}" height="${height}" rx="${previewCornerRadius}"/></clipPath>`,
        `<g clip-path="url(#c)">`,
        ...rects,
        `</g>`,
        `</svg>`,
    ].join("\n");
}

await Deno.writeTextFile(outFile, JSON.stringify(out));
await Deno.writeTextFile(previewFile, buildPreview(out.weeks) + "\n");
console.log(`Wrote ${outFile} and ${previewFile}: ${out.login}, ${out.weeks.length} weeks, ${out.total} contributions`);
