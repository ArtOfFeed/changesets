import fs from "fs-extra";
import path from "path";
import prettier from "prettier";
import humanId from "human-id";
import {
  CategoryOfChange,
  Changeset,
  Release,
  VersionType
} from "@changesets/types";
import { getKindTitle } from "../../cli/src/commands/add/createChangeset";

function groupByBumpType(releases: Release[]) {
  const major: Release[] = [];
  const minor: Release[] = [];
  const patch: Release[] = [];
  const none: Release[] = [];

  releases.forEach(rel => {
    if (rel.type === "major") major.push(rel);
    else if (rel.type === "minor") minor.push(rel);
    else if (rel.type === "patch") patch.push(rel);
    else major.push(rel);
  });
  return { major, minor, patch, none };
}
function getReleasesSection(releases: Release[]) {
  return `---
${releases.map(release => `"${release.name}": ${release.type}`).join("\n")}
---`;
}
function getChangeTypesSection(
  changeTypes: CategoryOfChange[],
  bumpType: VersionType
) {
  return `${changeTypes
    .filter(({ type }) => type === bumpType)
    .map(chk => `- [ ${getKindTitle(chk.category)} ] ${chk.description}`)
    .join("\n")}`;
}

async function writeChangeset(
  changeset: Changeset,
  cwd: string
): Promise<string> {
  const { summary, categoryOfChangeList, releases } = changeset;

  const changesetBase = path.resolve(cwd, ".changeset");

  // Worth understanding that the ID merely needs to be a unique hash to avoid git conflicts
  // experimenting with human readable ids to make finding changesets easier
  const changesetID = humanId({
    separator: "-",
    capitalize: false
  });

  const prettierConfig = await prettier.resolveConfig(cwd);

  const newChangesetPath = path.resolve(changesetBase, `${changesetID}.md`);

  const releasesGroupedByBumpTypes = Object.entries(groupByBumpType(releases))
    .filter(([, releases]) => releases.length)
    .map(
      ([bumpType, releases]) =>
        `${getReleasesSection(releases)} 
${getChangeTypesSection(categoryOfChangeList, bumpType as VersionType)}`
    )
    .join("\n");
  // NOTE: The quotation marks in here are really important even though they are
  // not spec for yaml. This is because package names can contain special
  // characters that will otherwise break the parsing step
  const changesetContents = `${
    categoryOfChangeList.length
      ? releasesGroupedByBumpTypes
      : getReleasesSection(releases)
  }

${summary}
  `;

  await fs.writeFile(
    newChangesetPath,
    prettier.format(changesetContents, {
      ...prettierConfig,
      parser: "markdown"
    })
  );

  return changesetID;
}

export default writeChangeset;
