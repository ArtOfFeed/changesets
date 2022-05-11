import chalk from "chalk";

import semver from "semver";

import * as cli from "../../utils/cli-utilities";
import { error, log } from "@changesets/logger";
import {
  Release,
  PackageJSON,
  Changeset,
  CategoryOfChange
} from "@changesets/types";
import { Package } from "@manypkg/get-packages";
import { ExitError } from "@changesets/errors";

const { green, yellow, red, bold, blue, cyan } = chalk;

const allCategoriesOfChange = [
  "Added (New functionality, arg options, more UI elements)",
  "Changed (Visual changes, internal changes, API changes)",
  "Removed (Dead code, feature flags, consumer API's)",
  "Types (Strictly related to the type system and should not have impact on runtime code) ",
  "Documentation (README, general docs, package.json metadata)",
  "Infra (Tooling, performance, things that are under the hood but should have no impact if a consumer upgraded)",
  "Misc (Anything else not noted above)"
];
type EmptyString = ``;
type ChangesetWithConfirmed = Changeset & { confirmed: boolean };

export function getKindTitle(kind: string) {
  return kind.split(" ")[0];
}

async function confirmMajorRelease(pkgJSON: PackageJSON) {
  if (semver.lt(pkgJSON.version, "1.0.0")) {
    // prettier-ignore
    log(yellow(`WARNING: Releasing a major version for ${green(pkgJSON.name)} will be its ${red('first major release')}.`))
    log(
      yellow(
        `If you are unsure if this is correct, contact the package's maintainers ${red(
          "before committing this changeset"
        )}.`
      )
    );

    let shouldReleaseFirstMajor = await cli.askConfirm(
      bold(
        `Are you sure you want to release the ${red(
          "first major version"
        )} of ${pkgJSON.name}?`
      )
    );
    return shouldReleaseFirstMajor;
  }
  return true;
}

async function setSummary(changeSet: ChangesetWithConfirmed) {
  log(
    "Please enter a summary for this change (this will be in the changelogs)."
  );
  log(chalk.gray("  (submit empty line to open external editor)"));

  let summary = await cli.askQuestion("Summary");
  if (summary.length === 0) {
    try {
      summary = cli.askQuestionWithEditor(
        "\n\n# Please enter a summary for your changes.\n# An empty message aborts the editor."
      );
      if (summary.length > 0) {
        changeSet.summary = summary;
        changeSet.confirmed = true;
        return;
      }
    } catch (err) {
      log(
        "An error happened using external editor. Please type your summary here:"
      );
    }

    summary = await cli.askQuestion("");
    while (summary.length === 0) {
      summary = await cli.askQuestion(
        "\n\n# A summary is required for the changelog! 😪"
      );
    }
  }

  changeSet.summary = summary;
  changeSet.confirmed = false;
}

async function chooseAtLeastOne(
  callbackToRetry: () => Promise<any[]>,
  errorMessage: string
) {
  let selectedItems = await callbackToRetry();

  while (selectedItems.length === 0) {
    error(errorMessage);
    error("(You most likely hit enter instead of space!)");

    selectedItems = await callbackToRetry();
  }
  return selectedItems;
}

async function getPackagesToRelease(
  changedPackages: Array<string>,
  allPackages: Array<Package>
) {
  function askInitialReleaseQuestion(defaultChoiceList: Array<any>) {
    return cli.askCheckboxPlus(
      // TODO: Make this wording better
      // TODO: take objects and be fancy with matching
      `Which packages would you like to include?`,
      defaultChoiceList,
      x => {
        // this removes changed packages and unchanged packages from the list
        // of packages shown after selection
        if (Array.isArray(x)) {
          return x
            .filter(x => x !== "changed packages" && x !== "unchanged packages")
            .map(x => cyan(x))
            .join(", ");
        }
        return x;
      }
    );
  }

  if (allPackages.length > 1) {
    const unchangedPackagesNames = allPackages
      .map(({ packageJson }) => packageJson.name)
      .filter(name => !changedPackages.includes(name));

    const defaultChoiceList = [
      {
        name: "changed packages",
        choices: changedPackages
      },
      {
        name: "unchanged packages",
        choices: unchangedPackagesNames
      }
    ].filter(({ choices }) => choices.length !== 0);

    let packagesToRelease = await chooseAtLeastOne(
      () => askInitialReleaseQuestion(defaultChoiceList),
      "You must select at least one package to release"
    );

    return packagesToRelease.filter(
      pkgName =>
        pkgName !== "changed packages" && pkgName !== "unchanged packages"
    );
  }
  return [allPackages[0].packageJson.name];
}

function formatPkgNameAndVersion(pkgName: string, version: string) {
  return `${bold(pkgName)}@${bold(version)}`;
}

export default async function createChangeset(
  changedPackages: Array<string>,
  allPackages: Package[]
): Promise<Array<ChangesetWithConfirmed>> {
  const releases: Array<Release> = [];
  const categoryOfChangeList: Array<CategoryOfChange> = [];
  const changesetList: Array<ChangesetWithConfirmed> = [];
  let shouldAskChangeTypes = false;

  if (allPackages.length > 1) {
    const packagesToRelease = await getPackagesToRelease(
      changedPackages,
      allPackages
    );

    let pkgJsonsByName = new Map(
      allPackages.map(({ packageJson }) => [packageJson.name, packageJson])
    );

    let pkgsLeftToGetBumpTypeFor = new Set(packagesToRelease);

    const chosenCategoryOfChangeList = await cli.askCheckboxPlus(
      bold(`What kind of change are you making? (check all that apply)`),
      allCategoriesOfChange.map(categoryOfChange => ({
        name: categoryOfChange,
        message: categoryOfChange
      })),
      (chosenCategoryOfChangeList: EmptyString | string[]) => {
        if (Array.isArray(chosenCategoryOfChangeList)) {
          return chosenCategoryOfChangeList
            .map(x => cyan(getKindTitle(x)))
            .join(", ");
        }
      }
    );
    shouldAskChangeTypes = chosenCategoryOfChangeList.length > 0;

    let pkgsThatShouldBeMajorBumped = (
      await cli.askCheckboxPlus(
        bold(`Which packages should have a ${red("major")} bump?`),
        [
          {
            name: "all packages",
            choices: packagesToRelease.map(pkgName => {
              return {
                name: pkgName,
                message: formatPkgNameAndVersion(
                  pkgName,
                  pkgJsonsByName.get(pkgName)!.version
                )
              };
            })
          }
        ],
        x => {
          // this removes changed packages and unchanged packages from the list
          // of packages shown after selection
          if (Array.isArray(x)) {
            return x
              .filter(x => x !== "all packages")
              .map(x => cyan(x))
              .join(", ");
          }
          return x;
        }
      )
    ).filter(x => x !== "all packages");

    for (const pkgName of pkgsThatShouldBeMajorBumped) {
      // for packages that are under v1, we want to make sure major releases are intended,
      // as some repo-wide sweeping changes have mistakenly release first majors
      // of packages.
      let pkgJson = pkgJsonsByName.get(pkgName)!;

      let shouldReleaseFirstMajor = await confirmMajorRelease(pkgJson);
      if (shouldReleaseFirstMajor) {
        pkgsLeftToGetBumpTypeFor.delete(pkgName);

        releases.push({ name: pkgName, type: "major" });
      }
    }

    if (pkgsLeftToGetBumpTypeFor.size !== 0) {
      let pkgsThatShouldBeMinorBumped = (
        await cli.askCheckboxPlus(
          bold(`Which packages should have a ${green("minor")} bump?`),
          [
            {
              name: "all packages",
              choices: [...pkgsLeftToGetBumpTypeFor].map(pkgName => {
                return {
                  name: pkgName,
                  message: formatPkgNameAndVersion(
                    pkgName,
                    pkgJsonsByName.get(pkgName)!.version
                  )
                };
              })
            }
          ],
          x => {
            // this removes changed packages and unchanged packages from the list
            // of packages shown after selection
            if (Array.isArray(x)) {
              return x
                .filter(x => x !== "all packages")
                .map(x => cyan(x))
                .join(", ");
            }
            return x;
          }
        )
      ).filter(x => x !== "all packages");

      for (const pkgName of pkgsThatShouldBeMinorBumped) {
        pkgsLeftToGetBumpTypeFor.delete(pkgName);

        releases.push({ name: pkgName, type: "minor" });
      }
    }

    if (pkgsLeftToGetBumpTypeFor.size !== 0) {
      log(`The following packages will be ${blue("patch")} bumped:`);
      pkgsLeftToGetBumpTypeFor.forEach(pkgName => {
        log(
          formatPkgNameAndVersion(pkgName, pkgJsonsByName.get(pkgName)!.version)
        );
      });

      for (const pkgName of pkgsLeftToGetBumpTypeFor) {
        releases.push({ name: pkgName, type: "patch" });
      }
    }
    if (shouldAskChangeTypes) {
      const bumpTypes = new Set(releases.map(rel => rel.type));
      const isSameMessageForAllPkgs = await cli.askConfirm(
        "Would you like to reuse the same message for all packages of this bump type?"
      );

      if (isSameMessageForAllPkgs) {
        for (const bumpType of bumpTypes) {
          const pkgsForThisBumpType = releases
            .filter(rel => rel.type === bumpType)
            .map(rel => rel.name)
            .join(", ");

          log(chalk.yellow(`${bumpType} :`), chalk.cyan(pkgsForThisBumpType));

          for (const category of chosenCategoryOfChangeList) {
            const description = await cli.askQuestion(
              `[ ${getKindTitle(category)} ]`
            );
            categoryOfChangeList.push({ description, category });
          }
        }
      } else {
        for (const release of releases) {
          log(chalk.yellow(`${release.type} :`), chalk.cyan(release.name));
          const currChangesetCategoryOfChangeList = [];

          for (const category of chosenCategoryOfChangeList) {
            const description = await cli.askQuestion(
              `[ ${getKindTitle(category)} ]`
            );
            currChangesetCategoryOfChangeList.push({ description, category });
          }
          changesetList.push({
            confirmed: true,
            summary: "",
            categoryOfChangeList: currChangesetCategoryOfChangeList,
            releases: [release]
          });
        }
      }
    }
  } else {
    let pkg = allPackages[0];
    let type = await cli.askList(
      `What kind of change is this for ${green(
        pkg.packageJson.name
      )}? (current version is ${pkg.packageJson.version})`,
      ["patch", "minor", "major"]
    );
    if (type === "major") {
      let shouldReleaseAsMajor = await confirmMajorRelease(pkg.packageJson);
      if (!shouldReleaseAsMajor) {
        throw new ExitError(1);
      }
    }
    releases.push({ name: pkg.packageJson.name, type });
  }
  if (!shouldAskChangeTypes) {
    changesetList.push({
      confirmed: false,
      summary: "",
      categoryOfChangeList: [],
      releases
    });
  }

  for (let changeset of changesetList) {
    await setSummary(changeset);
  }

  return changesetList;
}
