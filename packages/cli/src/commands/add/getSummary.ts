import * as cli from "../../utils/cli-utilities";
import { log } from "@changesets/logger";
import { ChangesetType } from "@changesets/types";

type SummaryPart = { changeType: ChangesetType; summaryPart: string };

export async function getSummary(
  changeTypes?: ChangesetType[]
): Promise<string> {
  if (changeTypes && changeTypes.length) {
    const summaryParts: SummaryPart[] = [];
    for (const changeType of changeTypes) {
      const part = await getSingleSummary(changeType);
      summaryParts.push({ changeType, summaryPart: part });
    }
    return ConcatSummaryParts(summaryParts);
  } else {
    return getSingleSummary();
  }
}

async function getSingleSummary(changeType?: ChangesetType): Promise<string> {
  const fotChangeTypeinsertion = changeType
    ? " for change [" + changeType.tag + "]"
    : "";

  let summary = await cli.askQuestion("Summary" + fotChangeTypeinsertion);
  if (summary.length === 0) {
    try {
      summary = cli.askQuestionWithEditor(
        "\n\n# Please enter a summary for your changes" +
          fotChangeTypeinsertion +
          ".\n# An empty message aborts the editor."
      );
      if (summary.length > 0) {
        return summary;
      }
    } catch (err) {
      log(
        "An error happened using external editor. Please type your summary" +
          fotChangeTypeinsertion +
          " here:"
      );
    }

    summary = await cli.askQuestion("");
    while (summary.length === 0) {
      summary = await cli.askQuestion(
        "\n\n# A summary is required for the changelog! 😪"
      );
    }
  }
  return summary;
}

function ConcatSummaryParts(parts: SummaryPart[]): string {
  return parts.reduce((reducer, part) => {
    const prefix = reducer.length ? "\n\n" : "";
    const partStr = " - [" + part.changeType.tag + "] " + part.summaryPart;
    return reducer + prefix + partStr;
  }, "");
}
