# Business Associate Agreement signing — vendor links

Direct links for getting BAAs in place with the upstream vendors brtlb
calls. Anyone running brtlb with real PHI needs each of these signed
before pointing real visits at it.

## AssemblyAI

DocuSign PowerForm:
https://na4.docusign.net/Member/PowerFormSigning.aspx?PowerFormId=12d882a8-2414-419a-9d61-5b15a3d20c19&env=na4&acct=327087e3-0eb7-4ce0-b492-10daade58b39&v=2

After signing, the BAA is associated with the AssemblyAI account whose
email you provide on the form. The same account's API key then becomes
PHI-eligible.

## OpenAI

BAAs are available on **Enterprise** and **Azure OpenAI** plans only.
Standard / pay-as-you-go and Plus / Team accounts cannot sign one.

- Enterprise: contact OpenAI sales — https://openai.com/enterprise
- Azure OpenAI: BAA is part of the standard Azure agreement
  (https://learn.microsoft.com/azure/compliance/offerings/offering-hipaa-us)

## Anthropic

BAAs are available on **Anthropic** Enterprise / API plans with custom
data retention. Contact Anthropic sales — https://www.anthropic.com/contact-sales

⚠️ Browser-side note: BAA-org Anthropic keys currently get a 401 with
"CORS requests are not allowed for this Organization" because the BAA
agreement enables custom retention which disables CORS. Plan to use
Anthropic only via a server-side proxy or a future native shell, not
the browser BYO-keys path.

## Google (Vertex AI; Gemini API ambiguous)

BAAs come through the **Google Cloud HIPAA-covered services** agreement.

**Confirmed BAA-covered (per Google's own docs):**
- **Vertex AI** (`*-aiplatform.googleapis.com`) — listed by name in
  Google's GCP HIPAA whitepaper. Uses service-account auth, not API
  keys. This is the unambiguous PHI path.

**Confirmed BAA-covered, but a different surface than brtlb uses:**
- **Gemini for Google Workspace** (`gemini.google.com`) — listed by
  name in the September 2025 Workspace HIPAA Implementation Guide.
  This is the user-facing chat product, NOT the API.

**Ambiguous from public docs:**
- The standalone **Gemini API** at `generativelanguage.googleapis.com`
  — which is what brtlb's `gemini-api-key` adapter calls — does NOT
  appear by name in Google's published HIPAA covered-services lists I
  could verify. Secondary sources (Nightfall AI, Paubox, etc.) suggest
  API-driven workloads in a billing-enabled Cloud project ARE covered,
  but I have not seen this confirmed in Google's own BAA terms or
  whitepapers.

**Recommendation:**
- For an ambiguity-free BAA-clean Gemini deployment, use **Vertex AI**.
- If you want to use the Gemini API endpoint directly, **confirm
  coverage with Google** for your specific Cloud account before sending
  PHI. Don't rely on third-party blog posts.
- Free `aistudio.google.com` keys from a personal Gmail (no associated
  Cloud project) are NOT under any GCP BAA. Fine for synthetic-data
  testing only.

To set up the BAA:
- Workspace admin console → accept the HIPAA agreement, OR contact
  Google Cloud sales for non-Workspace orgs
- Confirm in writing which specific services the BAA covers
- References:
  - https://cloud.google.com/security/compliance/hipaa
  - https://services.google.com/fh/files/misc/hipaa_overview_guide_googlecloud_whitepaper.pdf
  - https://services.google.com/fh/files/misc/gsuite_cloud_identity_hipaa_implementation_guide.pdf
