// Feature-gating helpers — Self-hosted version
// All features are always enabled for self-hosted users.

function canRunBackgroundAgent(user) {
  return { eligible: true, reason: 'Self-hosted — all features enabled', plan: 'super_agent' };
}

const BACKGROUND_UPSELL = 'Self-hosted server — all features are enabled.';

const BACKGROUND_READY =
  '🚀 Running in the background. You can close the dashboard — I will message you here when it is done.\n' +
  '(Requires the Global Executive extension to be installed and Chrome to be open.)';

module.exports = { canRunBackgroundAgent, ELIGIBLE_PLANS: ['super_agent'], BACKGROUND_UPSELL, BACKGROUND_READY };
