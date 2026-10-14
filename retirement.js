// Retirement drawdown model, shared by the Admin chart and the dashboard
// tiles so the two can't drift apart. Needs lib.js loaded first.
//
// Simulates spending down the ISA (non-taxable) and Pension (taxable) pots
// together: both pots grow monthly at Expected Pot Growth, then that month's
// spend (rising smoothly at Spend Increase by) is drawn from each pot in
// proportion to its balance. The pension side is grossed up so the tax it
// loses still leaves the intended net amount in hand; if one pot runs dry
// the rest of that month's spend comes from whichever pot still has money.

const DEFAULT_DRAWDOWN_RATE = 4;

// Share of the Pension pot assumed to be kept after tax in the dashboard's
// "Potential Net Income" estimate.
const PENSION_NET_FACTOR = 0.65;

// app_settings keys, by the names the code uses.
const RETIREMENT_KEYS = {
  drawdownRate: 'pension_drawdown_rate',
  spend: 'retirement_net_monthly_spend',
  potGrowth: 'retirement_pot_growth_rate',
  spendIncrease: 'retirement_spend_increase_rate',
  dob: 'retirement_dob',
  taxRate: 'retirement_tax_rate',
  statePension: 'retirement_state_pension_enabled',
  statePensionStartDate: 'retirement_state_pension_start_date',
  clearDebt: 'retirement_clear_debt_enabled',
  otherAssetsPension: 'retirement_other_assets_pension_enabled',
};
const RETIREMENT_SETTING_KEYS = Object.values(RETIREMENT_KEYS);

// State Pension: a flat £650/month in April-2025 money, uprated once a year
// every April by the Spend Increase by rate — growth keeps accruing from
// April 2025 regardless, but nothing is actually paid out (and netted off
// the spend target) until the start date (default April 2035).
const STATE_PENSION_BASE = 650;
const STATE_PENSION_GROWTH_START = new Date(2025, 3, 1);
const STATE_PENSION_PAYMENT_START = new Date(2035, 3, 1);

function statePensionAmountAt(date, spendRatePct, paymentStartDate) {
  if (date < paymentStartDate) return 0;
  let years = date.getFullYear() - STATE_PENSION_GROWTH_START.getFullYear();
  if (date.getMonth() < STATE_PENSION_GROWTH_START.getMonth()) years -= 1;
  if (years < 0) years = 0;
  const rate = Math.max(spendRatePct, 0) / 100;
  return STATE_PENSION_BASE * Math.pow(1 + rate, years);
}

function drawdownRateOf(settings) {
  const raw = settings[RETIREMENT_KEYS.drawdownRate];
  const v = Number(raw);
  return raw == null || raw === '' || Number.isNaN(v) ? DEFAULT_DRAWDOWN_RATE : v;
}

// settings: { [db key]: value } as stored (numbers, booleans, strings).
// Returns null if the inputs needed to run the model aren't all set.
function retirementConfig(settings) {
  const num = (k) => { const v = settings[k]; return v == null || v === '' ? NaN : Number(v); };
  const spend0 = num(RETIREMENT_KEYS.spend);
  const potGrowthPct = num(RETIREMENT_KEYS.potGrowth);
  const spendRatePct = num(RETIREMENT_KEYS.spendIncrease);
  const taxRatePct = num(RETIREMENT_KEYS.taxRate);
  if (!spend0 || [potGrowthPct, spendRatePct, taxRatePct].some(Number.isNaN)) return null;

  const dobStr = settings[RETIREMENT_KEYS.dob];
  const startStr = settings[RETIREMENT_KEYS.statePensionStartDate];
  return {
    spend0, potGrowthPct, spendRatePct, taxRatePct,
    dob: dobStr ? parseISODate(dobStr) : null,
    statePensionEnabled: settings[RETIREMENT_KEYS.statePension] === true,
    statePensionStart: startStr ? parseISODate(startStr) : STATE_PENSION_PAYMENT_START,
    clearDebt: settings[RETIREMENT_KEYS.clearDebt] === true,
    otherAssetsPension: settings[RETIREMENT_KEYS.otherAssetsPension] === true,
  };
}

// ISA pot (optionally including pension-flagged other assets, less debt) and
// Pension pot, as the model uses them.
function retirementPots(totals, otherAssets, cfg) {
  let isa = totals.byType.ISA || 0;
  if (cfg.otherAssetsPension) isa += otherAssetsTotal(otherAssets, { pensionOnly: true });
  return { isa, pension: totals.byType.Pension || 0 };
}

function retirementStartingIsa(pots, cfg, totalDebt) {
  return cfg.clearDebt ? Math.max(0, pots.isa - totalDebt) : pots.isa;
}

function retirementHorizonMonths(cfg, today = new Date()) {
  return cfg.dob ? Math.max(12, (100 - ageAt(cfg.dob, today).years) * 12) : 60 * 12;
}

function simulateRetirement(cfg, isa0, pension0, maxMonths) {
  const taxRate = Math.min(Math.max(cfg.taxRatePct, 0), 99) / 100;
  const monthlyGrowth = Math.pow(1 + Math.max(cfg.potGrowthPct, 0) / 100, 1 / 12) - 1;
  const spendRate = Math.max(cfg.spendRatePct, 0) / 100;

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  let isa = isa0, pension = pension0;
  const points = [{ date: new Date(today.getFullYear(), today.getMonth(), today.getDate()), isa, pension, total: isa + pension }];
  let depletion = null;

  for (let m = 0; m < maxMonths; m++) {
    isa *= (1 + monthlyGrowth);
    pension *= (1 + monthlyGrowth);
    const date = new Date(start.getFullYear(), start.getMonth() + m, 1);
    let target = cfg.spend0 * Math.pow(1 + spendRate, m / 12);
    if (cfg.statePensionEnabled) {
      target = Math.max(0, target - statePensionAmountAt(date, cfg.spendRatePct, cfg.statePensionStart));
    }

    const totalAB = isa + pension;
    let desiredIsa = 0, desiredPensionNet = 0;
    if (totalAB > 0) {
      desiredIsa = target * isa / totalAB;
      desiredPensionNet = target * pension / totalAB;
    } else {
      desiredIsa = target;
    }
    const desiredPensionGross = desiredPensionNet / (1 - taxRate);

    let actualIsa = Math.min(desiredIsa, isa);
    let shortfall = desiredIsa - actualIsa;
    let actualPensionGross = Math.min(desiredPensionGross, pension);
    const actualPensionNet = actualPensionGross * (1 - taxRate);
    shortfall += desiredPensionNet - actualPensionNet;

    let remainingIsa = isa - actualIsa;
    let remainingPension = pension - actualPensionGross;
    if (shortfall > 1e-9) {
      const extraIsa = Math.min(shortfall, remainingIsa);
      actualIsa += extraIsa; shortfall -= extraIsa; remainingIsa -= extraIsa;
      if (shortfall > 1e-9) {
        const extraPensionGross = Math.min(shortfall / (1 - taxRate), remainingPension);
        actualPensionGross += extraPensionGross;
        shortfall -= extraPensionGross * (1 - taxRate);
        remainingPension -= extraPensionGross;
      }
    }

    isa -= actualIsa;
    pension -= actualPensionGross;
    if (isa < 1e-6) isa = 0;
    if (pension < 1e-6) pension = 0;

    points.push({ date, isa, pension, total: isa + pension, target });

    if (shortfall > 1e-6) {
      depletion = { date };
      break;
    }
  }
  return { points, depletion };
}
