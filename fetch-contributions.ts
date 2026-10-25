import { z } from "zod";
import { buildPreview } from "./preview-svg.ts";

const tokenFile = ".env";
const tokenEnv = ["CONTRIB_TOKEN", "GITHUB_TOKEN"];
const outFile = "contributions.json";
const previewFile = "preview.svg";
const login = Deno.env.get("CONTRIB_LOGIN") ?? "";

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

await Deno.writeTextFile(outFile, JSON.stringify(out));
await Deno.writeTextFile(previewFile, (await buildPreview(out.weeks)) + "\n");
console.log(`Wrote ${outFile} and ${previewFile}: ${out.login}, ${out.weeks.length} weeks, ${out.total} contributions`);
