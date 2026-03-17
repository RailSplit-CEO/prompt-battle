# Plan: Legal Requirements for In-Game Purchases

## Context

The game is a web-based browser game selling virtual currency (crowns) + battle pass subscription via Stripe/Square. The developer has an LLC. This plan lists every legal requirement needed before processing real-money purchases.

---

## MUST-HAVE LEGAL PAGES (create on your website)

### 1. Terms of Service
- Virtual currency is a **limited license**, not property
- Crowns have **no real-world monetary value**, are non-refundable, non-transferable
- Cannot be exchanged for real money (avoids Money Transmitter classification)
- Developer can modify/terminate service
- Prohibited conduct (cheating, harassment)
- Dispute resolution / arbitration clause
- Liability limitations
- **EU users**: 14-day withdrawal right disclosure + waiver mechanism

### 2. Privacy Policy
- What data you collect (email, IP, payment info, behavioral data)
- Processing purposes (account mgmt, payments, analytics)
- Data retention periods
- Third-party sharing (Stripe, Firebase, analytics)
- **GDPR** (EU): Data subject rights (access, deletion, portability), lawful basis, data controller info, transfer mechanisms
- **CCPA** (California): Right to know, delete, opt-out of data sales, 2+ contact methods for requests
- **COPPA** (under-13): Parental consent flow, expanded data definition (IP, cookies, device IDs)
- International data transfer disclosure (EU-US Data Privacy Framework or SCCs)

### 3. Cookie Policy + Consent Banner
- Categorize cookies: Essential, Analytics, Marketing
- Banner with "Accept All" / "Reject All" (equally prominent)
- Separate toggles per category
- Ability to withdraw consent anytime
- Required before setting any non-essential cookies (EU ePrivacy Directive)

### 4. Refund Policy
- "Virtual currency and cosmetic items are non-refundable"
- EU users: 14-day withdrawal right waiver via checkbox + **email confirmation** (web-only confirmation is insufficient under EU law)
- Honor refunds for defective/bugged purchases
- Document refund exceptions for disputes

---

## PAYMENT PROCESSING REQUIREMENTS

### At Checkout, Display:
- [ ] Itemized breakdown: "500 Crowns = $4.99 USD"
- [ ] Total in user's local currency + applicable tax/VAT
- [ ] Company name and address
- [ ] "Confirm and Pay" button (no auto-charging)
- [ ] Pre-purchase confirmation: "I understand this is non-refundable" checkbox

### Email Receipt (within 24 hours):
- [ ] Transaction ID
- [ ] Item(s) purchased
- [ ] Amount charged (local currency)
- [ ] Date/time
- [ ] Last 4 digits of payment method
- [ ] Refund policy reminder
- [ ] Company contact details

### Subscription (Battle Pass) Specific:
- [ ] Disclose: recurring nature, amount, billing date, how to cancel
- [ ] **FTC Click-to-Cancel Rule**: Cancellation must be as easy as signup (web cancel if web signup)
- [ ] One-click cancel button in account settings
- [ ] Email reminder 1 week before auto-renewal
- [ ] Immediate confirmation of cancellation

### PCI DSS:
- [ ] Use Stripe Elements/Checkout or Square tokenized integration (never handle raw card data)
- [ ] Never log/store credit card numbers
- [ ] Annual validation of PCI-compliant integration

---

## AGE VERIFICATION & COPPA

- [ ] Age gate at signup: "Are you 13 or older?"
- [ ] If <13: Parental consent flow (collect parent email, send verification, parent confirms)
- [ ] Block or require parental approval for purchases by users <16 (per FTC Genshin Impact settlement precedent)
- [ ] Keep parental consent records for 2+ years
- [ ] Cannot retain child data beyond what's needed

---

## TAX OBLIGATIONS

### US Sales Tax:
- [ ] Determine economic nexus in taxing states (>$5k threshold in most)
- [ ] Register for sales tax permits in nexus states
- [ ] Collect sales tax at checkout (use Stripe Tax or TaxJar)
- [ ] Display: Subtotal + Tax = Total
- [ ] File quarterly/monthly returns, remit collected tax

### EU VAT:
- [ ] If >€10k annual digital sales to EU: register for One Stop Shop (OSS)
- [ ] Collect VAT at customer's local rate (17-27% by country)
- [ ] Verify customer location (2 pieces of evidence: IP + billing address)
- [ ] File quarterly OSS return
- [ ] Keep records for 6 years

### Tax Reporting:
- [ ] Track gross revenue for IRS reporting
- [ ] Stripe/Square issues 1099-K if >$20k + 200 transactions
- [ ] File business tax return annually

---

## VIRTUAL CURRENCY DISCLAIMERS (in ToS + Store UI)

- [ ] "Crowns do not represent legal tender or currency"
- [ ] "Crowns are not redeemable for fiat currency"
- [ ] "Crowns have no equivalent value in real currency"
- [ ] "Crowns cannot be exchanged for goods/services outside the game"
- [ ] "Developer retains right to modify or terminate virtual currency"
- [ ] "Player has no property rights in virtual currency"
- [ ] Show real-money equivalent next to crown prices in store: "500 Crowns (~$4.99)"

---

## BUSINESS INFO TO DISPLAY ON WEBSITE

- [ ] Company legal name (LLC name)
- [ ] Physical address (registered office, not PO Box for EU)
- [ ] Email for legal/support inquiries
- [ ] Contact form (CCPA requires 2+ contact methods)
- [ ] Footer: "© 2026 [Company Name] | [Address] | [Email]"
- [ ] Registered agent in LLC's state of incorporation

---

## IF YOU ADD LOOT BOXES / RANDOMIZED PURCHASES

- [ ] Disclose odds before purchase: "10% Legendary, 30% Rare, 60% Common"
- [ ] Display on store page AND at checkout
- [ ] Consider avoiding loot boxes entirely (reduces regulatory risk in Belgium, Netherlands, Australia)

---

## RECORD-KEEPING (2+ years minimum)

- [ ] Transaction logs (user ID, amount, date, payment method)
- [ ] Receipts/invoices
- [ ] Refund records
- [ ] Chargeback documentation
- [ ] Parental consent records
- [ ] Cookie consent records
- [ ] GDPR data deletion request logs
- [ ] Tax records: 7 years

---

## ACCESSIBILITY (ADA / WCAG 2.2 Level AA)

- [ ] Keyboard navigation support
- [ ] Color contrast ratios (4.5:1 for text)
- [ ] Colorblind modes
- [ ] Resizable text
- [ ] Keyboard focus indicators

---

## SUMMARY PRIORITY ORDER

**Before first sale:**
1. Terms of Service + Privacy Policy + Cookie Policy pages
2. Age gate at signup
3. Stripe/Square tokenized checkout (PCI compliant)
4. Email receipts
5. Company info in footer
6. Virtual currency disclaimers in store UI
7. Subscription cancel button

**Within first quarter:**
8. Tax setup (Stripe Tax for US sales tax + EU VAT)
9. GDPR withdrawal waiver flow (email confirmation)
10. COPPA parental consent flow
11. Transaction record-keeping system
12. Accessibility basics

**Ongoing:**
13. Annual compliance review (regulations change frequently)
14. Monitor state sales tax changes
15. Respond to GDPR/CCPA requests within 30/45 days
