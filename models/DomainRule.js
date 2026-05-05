// Global Executive — Per-Domain Rule Model
// User-defined rules that apply whenever the agent is working on a
// specific domain. Injected into the system prompt as HARD constraints
// the agent MUST follow on that domain, regardless of task/mode.
//
// Example:
//   { domain: "amazon.com", rule: "Never place an order without explicit
//     confirmation — always use confirmAction before checkout." }
//
// The agent loop scans rules matching the current active tab's hostname
// (exact match or sub-domain match) every step.

const mongoose = require('mongoose');

const domainRuleSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Lowercase hostname pattern. Supports:
  //   "amazon.com"         — matches amazon.com + any subdomain
  //   "www.amazon.com"     — exact match
  //   "*"                  — applies to every site (use sparingly!)
  domain: {
    type: String,
    required: true,
    maxlength: 253,
    trim: true,
    lowercase: true
  },
  rule: {
    type: String,
    required: true,
    maxlength: 1000,
    trim: true
  },
  // Severity drives how it's rendered to the agent.
  //  - 'must'    : HARD constraint, must never be violated.
  //  - 'should'  : strong preference.
  //  - 'info'    : background context.
  severity: {
    type: String,
    enum: ['must', 'should', 'info'],
    default: 'must'
  },
  enabled: { type: Boolean, default: true }
}, { timestamps: true });

domainRuleSchema.index({ userId: 1, domain: 1, enabled: 1 });

module.exports = mongoose.model('DomainRule', domainRuleSchema);
