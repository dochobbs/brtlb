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

## Google (Gemini API + Vertex AI)

BAAs come through the **Google Cloud HIPAA-covered services** agreement.
Both **Vertex AI** and the **Gemini API** (when used through a billing-
enabled Google Cloud project) are on the covered list.

What's covered:
- Gemini API key issued from your Google Cloud project (APIs & Services
  → Credentials → Create API Key) with billing enabled on the project
- Vertex AI (`*-aiplatform.googleapis.com`) via service-account auth

What's NOT covered:
- Free-tier `aistudio.google.com` keys created from a personal Gmail
  with no associated Cloud project — fine for synthetic-data testing
  only

To set up the BAA:
- Workspace admin console → accept the HIPAA agreement, OR contact
  Google Cloud sales for non-Workspace orgs
- Confirm Gemini API + Vertex AI are listed under your covered services
- Reference: https://cloud.google.com/security/compliance/hipaa
