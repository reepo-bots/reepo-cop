import LabelService from './labelService';
import PRService from './prService';
import ContextService, { HookContext } from './contextService';
import IssueService from './issueService';
import ReleaseService from './releaseService';
import { PRAction } from '../model/model_pr_action';
import GHRelease from '../model/model_ghRelease';
import GHPr from '../model/model_ghPR';

export default class BotService {
  private _labelService: LabelService;
  private _prService: PRService;
  private _contextService: ContextService;
  private _issueService: IssueService;
  private _releaseService: ReleaseService;

  constructor() {
    this._labelService = new LabelService();
    this._prService = new PRService();
    this._contextService = new ContextService();
    this._issueService = new IssueService();
    this._releaseService = new ReleaseService();
  }

  public async updateDraftRelease(context: HookContext): Promise<boolean> {
    const existingRelease: GHRelease | undefined = await this._contextService.getLastReleaseRetriever(
      context
    )('draft');

    if (!existingRelease) {
      return true;
    }

    return this._releaseService.updateReleaseChangelog(
      existingRelease,
      this._contextService.getLastReleaseRetriever(context),
      this._contextService.getPRRetriever(context),
      this._contextService.getReleaseUpdater(context)
    );
  }

  /**
   * Performs a set of actions on an incoming PR based on its
   * context type.
   * @param context - Context Object provided by Probot.
   * @param prAction - Type of PR context to handle.
   */
  public async handlePR(context: HookContext, prAction: PRAction): Promise<boolean> {
    const prHandlingResults: boolean[] = [];
    await this.handleLabelValidation(context);

    const pr: GHPr | undefined = await this._contextService.extractPullRequestFromHook(context);
    if (!pr) {
      console.error('Unable to handle PR: No PR in context');
      return false;
    }

    if (prAction === PRAction.OPENED || prAction === PRAction.READY_FOR_REVIEW) {
      prHandlingResults.push(
        await this._prService.handlePRCongratulation(
          pr,
          this._contextService.getPRRetriever(context),
          this._contextService.getPRCommenter(context)
        )
      )
    }

    if (prAction === PRAction.OPENED || prAction === PRAction.EDITED || prAction === PRAction.READY_FOR_REVIEW) {
      prHandlingResults.push(
        await this._prService.validatePRCommitMessageProposal(pr, this._contextService.getPRCommenter(context)),
        await this._prService.assignAspectLabel(
          pr,
          this._contextService.getPRLabelReplacer(context),
          this._contextService.getIssueRetriever(context)
        )
      );
    }

    if (
      prAction === PRAction.READY_FOR_REVIEW ||
      prAction === PRAction.CONVERTED_TO_DRAFT ||
      prAction === PRAction.OPENED
    ) {
      prHandlingResults.push(await this.handlePRLabelReplacement(context, pr, prAction));
    }

    return prHandlingResults.reduce(
      (previousResults: boolean, currentResult: boolean) => previousResults && currentResult
    );
  }

  /**
   * Replaces existing PR Label with new ones depending on the type of action
   * taking place on said PR.
   * @param context - Context Object provided by Probot.
   * @param prAction - PR's Condition (What action to PR triggered this hook.)
   * @returns promise of true if label replacement was successful, false otherwise.
   */
  private async handlePRLabelReplacement(context: HookContext, pr: GHPr, prAction: PRAction): Promise<boolean> {
    return this._prService.replaceExistingPRLabels(
      this._contextService.getPRLabelReplacer(context),
      this._contextService.extractLabelsFromPRHook(context),
      prAction,
      pr
    );
  }

  /**
   * Crafts and posts a comment of congratulation to a user for achieving a milestone
   * number of items.
   * @param context - Context Object provided by Probot.
   * @param congratulationType - string to check item for congratulation (i.e. PR/Issue).
   * @returns promise of true if message was successfully posted, false otherwise.
   */
  public async handleUserCongratulatoryMessage(
    context: HookContext,
    congratulationType: 'Issue' | 'PR'
  ): Promise<boolean> {
    switch (congratulationType) {
      case 'Issue':
        return await this._issueService.handleIssueCongratulation(
          this._contextService.extractUserFromIssueHook(context),
          this._contextService.extractIssueFromHook(context),
          this._contextService.getAuthorsIssuesRetriever(context),
          this._contextService.getIssueCommentCreator(context)
        );
      case 'PR':
        console.log('PR Congratulation Function - Work In Progress');
        return false;
      default:
        return false;
    }

    return false;
  }

  /**
   * Attempts to auto-label an issue based on keywords present on its title. Performs
   * a label validation on the repo prior to auto-labelling.
   * @param context - Context Object provided by Probot.
   * @returns a promise of true if automated labelling was a success, false otherwise.
   */
  public async handleAutomatedIssueLabelling(context: HookContext): Promise<boolean> {
    await this.handleLabelValidation(context);

    if (
      !(await this._issueService.performAutomatedLabelling(
        this._contextService.extractIssueFromHook(context),
        this._contextService.getAspectLabelReplacer(context)
      ))
    ) {
      console.log('Automated Issue Lablling has encountered an error.');
      return false;
    }

    return true;
  }

  /**
   * Ensures that all labels are validated prior to any Bot-Actions
   * involving labels.
   * @param context - Context Object provided by Probot.
   * @returns A promise of true if label validation was successful and
   * false otherwise.
   */
  public async handleLabelValidation(context: HookContext): Promise<boolean> {
    return await this._labelService.validateLabelsOnGihtub(
      this._contextService.getRepoLabelsRetriever(context),
      this._contextService.getLabelUpdater(context),
      this._contextService.getLabelCreator(context)
    );
  }
}
