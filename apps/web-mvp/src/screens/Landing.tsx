import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';

const LANDING_CSS_HREF = '/landing-assets/landing.css';
const LANDING_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Sentient:wght@400;500;600;700&family=General+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap';

function useLandingStyles(): void {
  useEffect(() => {
    const links: HTMLLinkElement[] = [];

    const preconnect1 = document.createElement('link');
    preconnect1.rel = 'preconnect';
    preconnect1.href = 'https://fonts.googleapis.com';
    document.head.appendChild(preconnect1);
    links.push(preconnect1);

    const preconnect2 = document.createElement('link');
    preconnect2.rel = 'preconnect';
    preconnect2.href = 'https://fonts.gstatic.com';
    preconnect2.crossOrigin = 'anonymous';
    document.head.appendChild(preconnect2);
    links.push(preconnect2);

    const fonts = document.createElement('link');
    fonts.rel = 'stylesheet';
    fonts.href = LANDING_FONTS_HREF;
    document.head.appendChild(fonts);
    links.push(fonts);

    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = LANDING_CSS_HREF;
    css.dataset.brtlbLanding = 'true';
    document.head.appendChild(css);
    links.push(css);

    document.body.dataset.brtlbLanding = 'true';

    return () => {
      links.forEach((el) => el.remove());
      delete document.body.dataset.brtlbLanding;
    };
  }, []);
}

function useScrollReveal(): void {
  // useLayoutEffect (not useEffect) so the .reveal class is added before
  // the browser paints — otherwise readers see sections render fully, then
  // vanish, then fade back in. We also flip .is-visible synchronously on
  // anything that's already in (or near) the viewport, so above-the-fold
  // content paints as visible on frame 1. Observer only watches the rest.
  useLayoutEffect(() => {
    const targets = document.querySelectorAll(
      'section, .who-card, .tmpl, .privacy-card, .how-step, .faq-list details, .cost-card',
    );
    const vh = window.innerHeight || 800;
    const visibleThreshold = vh * 0.92;
    const pending: Element[] = [];

    targets.forEach((el) => {
      el.classList.add('reveal');
      const rect = el.getBoundingClientRect();
      if (rect.top < visibleThreshold) {
        el.classList.add('is-visible');
      } else {
        pending.push(el);
      }
    });

    if (pending.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' },
    );

    pending.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);
}

function useFakeClock(): string {
  const [label, setLabel] = useState('00:17');
  useEffect(() => {
    let s = 17;
    const id = setInterval(() => {
      s += 1;
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      setLabel(`${mm}:${ss}`);
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return label;
}

export function Landing() {
  const setView = useAppStore((s) => s.setView);

  useLandingStyles();
  useScrollReveal();
  const clockLabel = useFakeClock();

  const [menuOpen, setMenuOpen] = useState(false);
  const [activePatient, setActivePatient] = useState<'tommy' | 'lily'>('tommy');
  const navRef = useRef<HTMLElement>(null);

  const launchApp = (e?: React.MouseEvent): void => {
    if (e) e.preventDefault();
    setMenuOpen(false);
    setView('wizard');
  };

  // In-page anchors: prevent the browser from pushing /#how to history
  // (which would break our SPA back-button by triggering a popstate that
  // resolves '/' back to the home view, not landing). Scroll smoothly to
  // the target element instead; the URL stays at '/'.
  const scrollToAnchor = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    const href = e.currentTarget.getAttribute('href');
    if (!href || !href.startsWith('#')) return;
    e.preventDefault();
    setMenuOpen(false);
    if (href === '#top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const target = document.querySelector(href);
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const waveformBars = Array.from({ length: 35 });

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="site-header" data-header>
        <a className="brand" href="#top" aria-label="brtlb home" onClick={scrollToAnchor}>
          <span className="brand-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="brand-word">brtlb</span>
        </a>
        <nav
          ref={navRef}
          className={`nav${menuOpen ? ' is-open' : ''}`}
          aria-label="Primary navigation"
        >
          <a href="#why" onClick={scrollToAnchor}>
            Why brtlb
          </a>
          <a href="#how" onClick={scrollToAnchor}>
            How it works
          </a>
          <a href="#templates" onClick={scrollToAnchor}>
            Templates
          </a>
          <a href="#privacy" onClick={scrollToAnchor}>
            Privacy
          </a>
          <a href="#faq" onClick={scrollToAnchor}>
            FAQ
          </a>
          <a href="/docs/" onClick={() => setMenuOpen(false)}>
            Docs
          </a>
        </nav>
        <a href="#try" className="header-cta" onClick={launchApp}>
          Try it free →
        </a>
        <button
          className="menu-button"
          type="button"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span />
          <span />
        </button>
      </header>

      <main id="main">
        <a id="top" />

        {/* HERO */}
        <section className="hero">
          <div className="hero-grid">
            <div className="hero-copy">
              <p className="eyebrow">
                <span className="eyebrow-dot" /> v0.1 · for pediatric DPC
              </p>
              <h1 className="display">
                Pediatric notes, <em>compressed.</em>
              </h1>
              <p className="lede">
                Record the visit. Get a SOAP note in 30 seconds. Paste it into your EHR. brtlb runs
                entirely in your browser — your patient audio never touches our servers because{' '}
                <span className="underline-soft">we don't have any.</span>
              </p>
              <div className="hero-actions">
                <a className="button primary" href="#try" onClick={launchApp}>
                  Try it free
                  <span className="button-meta">brtlb.io</span>
                </a>
                <a className="button ghost" href="#how" onClick={scrollToAnchor}>
                  How it works
                </a>
              </div>
              <ul className="hero-strip">
                <li>
                  <strong>~$0.20</strong> per visit
                </li>
                <li>
                  <strong>No subscription</strong> · no minimums
                </li>
                <li>
                  <strong>5 min</strong> setup
                </li>
                <li>
                  <strong>BYO keys</strong> · AssemblyAI + Gemini
                </li>
              </ul>
            </div>

            <aside className="hero-stage" aria-label="Product preview">
              <div className="stage-frame">
                <div className="stage-chrome">
                  <span className="stage-light" />
                  <span className="stage-light" />
                  <span className="stage-light" />
                  <span className="stage-url">brtlb.io / visit</span>
                </div>
                <div className="visit-card" id="hero-visit-card">
                  <div className="visit-top">
                    <span className="status-pill">
                      <span className="pulse" /> Recording · ambient
                    </span>
                    <span className="time">{clockLabel}</span>
                  </div>
                  <div className="waveform" aria-hidden="true">
                    {waveformBars.map((_, i) => (
                      <span key={i} />
                    ))}
                  </div>
                  <div className="visit-meta">
                    <span>
                      Auto-detected · <strong>Well-Child</strong>
                    </span>
                    <span className="dot-sep">·</span>
                    <span>2 patients</span>
                  </div>

                  <div className="tabs">
                    <button
                      type="button"
                      className={`tab${activePatient === 'tommy' ? ' is-active' : ''}`}
                      onClick={() => setActivePatient('tommy')}
                    >
                      Tommy, 4y
                    </button>
                    <button
                      type="button"
                      className={`tab${activePatient === 'lily' ? ' is-active' : ''}`}
                      onClick={() => setActivePatient('lily')}
                    >
                      Lily, 6y
                    </button>
                  </div>

                  <div className="note-block" hidden={activePatient !== 'tommy'}>
                    <p className="note-section">SUBJECTIVE</p>
                    <p>
                      Parent reports 2-day history of right-sided ear tugging, low-grade fever to
                      38.4°C, decreased appetite. No vomiting. No URI prodrome.{' '}
                      <span className="hl">Sleep disrupted x2 nights.</span>
                    </p>
                    <p className="note-section">ASSESSMENT</p>
                    <p>Acute otitis media, right. Otherwise well-appearing.</p>
                  </div>
                  <div className="note-block" hidden={activePatient !== 'lily'}>
                    <p className="note-section">SUBJECTIVE</p>
                    <p>
                      6-year well-child check. Mom reports thriving at school, full sleep, varied
                      diet.{' '}
                      <span className="hl">
                        Three small parent concerns: thumb-sucking, occasional headaches, sibling
                        adjustment.
                      </span>
                    </p>
                    <p className="note-section">ASSESSMENT</p>
                    <p>Healthy 6yo. Growth tracking 50th. Development on target.</p>
                  </div>

                  <div className="visit-actions">
                    <button className="chip" type="button">
                      HPI
                    </button>
                    <button className="chip" type="button">
                      Exam
                    </button>
                    <button className="chip" type="button">
                      A/P
                    </button>
                    <button className="chip is-primary" type="button">
                      Copy all →
                    </button>
                  </div>
                </div>
              </div>

              <p className="stage-caption">
                <span className="dot-mark" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                Live preview — sibling-aware notes from one recording.
              </p>
            </aside>
          </div>
        </section>

        {/* MARQUEE */}
        <section className="marquee" aria-label="What brtlb captures">
          <div className="marquee-track">
            {[
              'SOAP',
              'Well-Child',
              'Sick Visit',
              'ADHD Med Check',
              'Procedure',
              'Behavioral Health',
              'Developmental Eval',
              'Follow-Up',
              'Dictation',
              'SOAP',
              'Well-Child',
              'Sick Visit',
              'ADHD Med Check',
              'Procedure',
              'Behavioral Health',
              'Developmental Eval',
              'Follow-Up',
              'Dictation',
            ].map((label, i) => (
              <span key={i}>
                {label}
                <i />
              </span>
            ))}
          </div>
        </section>

        {/* BARTLEBY */}
        <section className="bartleby section" aria-label="The name">
          <div className="bartleby-grid">
            <div className="bartleby-mark" aria-hidden="true">
              <span className="bartleby-mark-eyebrow">brtlb</span>
              <div className="bartleby-motion">
                <span className="bartleby-motion-full">
                  B<span>a</span>rtl<span>e</span>b<span>y</span>
                </span>
                <span className="bartleby-motion-dotted">
                  B<span>·</span>rtl<span>·</span>b<span>·</span>
                </span>
                <span className="bartleby-motion-final">brtlb</span>
              </div>
            </div>
            <ol className="bartleby-quotes">
              <li>
                <span className="bartleby-q">"I would prefer not to</span>
                <span className="bartleby-a">…chart after hours."</span>
              </li>
              <li>
                <span className="bartleby-q">"I prefer not to</span>
                <span className="bartleby-a">…get behind on my notes."</span>
              </li>
            </ol>
          </div>
        </section>

        {/* WHO IT'S FOR */}
        <section id="why" className="who section">
          <div className="section-head">
            <p className="eyebrow">
              <span className="eyebrow-dot" /> Who this is for
            </p>
            <h2 className="hh">
              Built by a pediatric DPC physician — for pediatric DPC physicians.
            </h2>
            <p className="body-copy">
              If you've been frustrated by generic AI scribes treating every visit like an adult
              internal-medicine appointment, you'll recognize the friction they ignore.
            </p>
          </div>
          <div className="who-grid">
            <article className="who-card">
              <span className="who-num">01</span>
              <h3>Sibling visits</h3>
              <p>
                Three kids in one room, one recording. Generic scribes flatten this into one note
                or get patient names confused. brtlb diarizes, attributes, and produces one note
                per child.
              </p>
            </article>
            <article className="who-card">
              <span className="who-num">02</span>
              <h3>Long developmental evals</h3>
              <p>
                Generic scribes time out at 30 minutes. brtlb handles up to 90 minutes — autism
                evals, behavioral intakes, complex med-management — saving every second locally so
                a flaky connection doesn't lose the visit.
              </p>
            </article>
            <article className="who-card">
              <span className="who-num">03</span>
              <h3>Sensitive adolescent disclosures</h3>
              <p>
                Independent review pass flags content the parent shouldn't see in a shared chart.
                Verbatim quote capture for medicolegal record.
              </p>
            </article>
            <article className="who-card">
              <span className="who-num">04</span>
              <h3>Pediatric vocabulary</h3>
              <p>
                "Atopic dermatitis," not "skin condition." "Acute otitis media," not "ear
                infection." The templates were written by a pediatrician with peds-specific
                anti-fabrication rules.
              </p>
            </article>
            <article className="who-card">
              <span className="who-num">05</span>
              <h3>Multi-template visits</h3>
              <p>
                Combined well-child + acute concern shouldn't collapse into a sick visit. brtlb
                preserves both threads with separate sections.
              </p>
            </article>
            <article className="who-card who-callout">
              <p className="who-callout-eyebrow">For the gap nobody serves</p>
              <p className="who-callout-body">
                The big AI scribes are great products targeting large enterprise health systems.
                brtlb explicitly doesn't compete there. It's for the ~250 independent pediatric DPC
                clinicians that fall through the gap between <em>too small for enterprise</em> and{' '}
                <em>doesn't fit generic mid-market.</em>
              </p>
            </article>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how" className="how section">
          <div className="section-head">
            <p className="eyebrow">
              <span className="eyebrow-dot" /> How it works
            </p>
            <h2 className="hh">Three steps. About thirty seconds.</h2>
          </div>

          <ol className="how-steps">
            <li className="how-step">
              <div className="how-step-num">01</div>
              <div className="how-step-body">
                <div className="how-step-lead">
                  <h3>Record the visit</h3>
                  <ul className="how-step-list">
                    <li>Pause / resume mid-visit</li>
                    <li>"Mark moment" tap flags clinically important passages</li>
                    <li>Wake Lock keeps the screen alive</li>
                    <li>Auto-save every second to local storage</li>
                  </ul>
                </div>
                <p>
                  One-tap <em>Record</em>. Ambient mode captures the room with speaker diarization;
                  dictation mode for physician-narrated notes. Subtle pulsing dot, modest timer.
                  Patient barely notices the screen.
                </p>
              </div>
            </li>
            <li className="how-step">
              <div className="how-step-num">02</div>
              <div className="how-step-body">
                <div className="how-step-lead">
                  <h3>Audio → AssemblyAI → transcript</h3>
                  <ul className="how-step-list">
                    <li>90-minute transcription budget</li>
                    <li>Speaker diarization · per-utterance attribution</li>
                    <li>Auto-delete from vendor on completion</li>
                    <li>Chapter markers on recordings ≥30 min</li>
                  </ul>
                </div>
                <p>
                  The audio uploads <em>directly from your browser</em> to AssemblyAI under your
                  AssemblyAI BAA. Adaptive timeout (~30 sec/MB) handles slow clinic WiFi. By
                  default, AssemblyAI is told to delete the file the moment we pull the result.
                </p>
              </div>
            </li>
            <li className="how-step">
              <div className="how-step-num">03</div>
              <div className="how-step-body">
                <div className="how-step-lead">
                  <h3>Transcript → Gemini → structured note</h3>
                  <ul className="how-step-list">
                    <li>9 built-in pediatric templates · custom with AI polish</li>
                    <li>Multi-patient splitting · per-tab edits</li>
                    <li>Hallucination + omission review · sensitive-content flag</li>
                    <li>Per-section copy: All-in-one, Pick, or Walk-through</li>
                  </ul>
                </div>
                <p>
                  Transcript text is sent <em>directly from your browser</em> to Google Gemini
                  under your Workspace HIPAA BAA. brtlb auto-detects template, splits per child,
                  runs an independent review pass for hallucination/omission, and presents a draft
                  for clinician edit.
                </p>
              </div>
            </li>
          </ol>

          <figure className="dataflow" aria-label="Data flow architecture">
            <figcaption className="dataflow-cap">
              <span className="dataflow-cap-eyebrow">Architecture</span>
              <span className="dataflow-cap-title">brtlb is never in the data path.</span>
            </figcaption>
            <div className="dataflow-stage">
              <div className="dataflow-row">
                <div className="df-node df-vendor">
                  <div className="df-node-label">AssemblyAI</div>
                  <div className="df-node-sub">your BAA</div>
                </div>
                <div className="df-arrows">
                  <div className="df-arrow df-arrow-left">
                    <span className="df-arrow-label">audio</span>
                    <span className="df-arrow-line" />
                  </div>
                  <div className="df-arrow df-arrow-right">
                    <span className="df-arrow-label">transcript</span>
                    <span className="df-arrow-line" />
                  </div>
                </div>
                <div className="df-node df-browser">
                  <div className="df-node-label">Your browser</div>
                  <div className="df-node-sub">brtlb static code</div>
                </div>
                <div className="df-arrows">
                  <div className="df-arrow df-arrow-right">
                    <span className="df-arrow-label">text</span>
                    <span className="df-arrow-line" />
                  </div>
                  <div className="df-arrow df-arrow-left">
                    <span className="df-arrow-label">note</span>
                    <span className="df-arrow-line" />
                  </div>
                </div>
                <div className="df-node df-vendor">
                  <div className="df-node-label">Google Gemini</div>
                  <div className="df-node-sub">your Workspace BAA</div>
                </div>
              </div>
              <div className="dataflow-absent">
                <span className="absent-x" aria-hidden="true">
                  <svg
                    viewBox="0 0 32 32"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="5" y="5" width="22" height="9" rx="1.5" />
                    <rect x="5" y="18" width="22" height="9" rx="1.5" />
                    <circle cx="9" cy="9.5" r="1.2" fill="currentColor" stroke="none" />
                    <circle cx="9" cy="22.5" r="1.2" fill="currentColor" stroke="none" />
                    <line x1="3" y1="29" x2="29" y2="3" strokeWidth="2.6" />
                  </svg>
                </span>
                <div>
                  <strong>No brtlb server.</strong>
                  <span>
                    No database. No backend pipeline. Vercel only serves the static code; it never
                    sees PHI.
                  </span>
                </div>
              </div>
            </div>
          </figure>
        </section>

        {/* TEMPLATES */}
        <section id="templates" className="templates section">
          <div className="section-head">
            <p className="eyebrow">
              <span className="eyebrow-dot" /> Templates
            </p>
            <h2 className="hh">Nine built-ins. Plus anything you describe in plain English.</h2>
            <p className="body-copy">
              Each template was written by a pediatrician with template-specific safety scaffolding
              — anti-fabrication rules, anatomic-laterality discipline, diagnostic-specificity
              guards, consistency check.
            </p>
          </div>
          <div className="templates-grid">
            <article className="tmpl tmpl-default">
              <span className="tmpl-tag">Default</span>
              <h3>SOAP</h3>
              <p>
                Mixed-visit handling and encounter framing. The fallback when nothing more specific
                applies.
              </p>
            </article>
            <article className="tmpl">
              <span className="tmpl-tag">Most-used</span>
              <h3>Well-Child</h3>
              <p>
                Growth, milestones, anticipatory guidance, vaccines. Captures every parent concern
                (typical visit has 4–6 small threads).
              </p>
            </article>
            <article className="tmpl">
              <span className="tmpl-tag">High-volume</span>
              <h3>Sick Visit</h3>
              <p>Acute illness, symptom timeline, return precautions, pediatric red flags.</p>
            </article>
            <article className="tmpl">
              <span className="tmpl-tag">Quick</span>
              <h3>Follow-Up</h3>
              <p>Interim status on a known condition. Compact by design.</p>
            </article>
            <article className="tmpl">
              <span className="tmpl-tag">Recurring</span>
              <h3>ADHD Med Check</h3>
              <p>Response, side effects, vitals on stimulants. Structured for refill workflow.</p>
            </article>
            <article className="tmpl">
              <span className="tmpl-tag">Procedural</span>
              <h3>Procedure</h3>
              <p>
                Laceration repair, I&amp;D, ear curettage, frenectomy — sterile-technique
                narrative.
              </p>
            </article>
            <article className="tmpl tmpl-emph">
              <span className="tmpl-tag">Sensitive</span>
              <h3>Behavioral Health</h3>
              <p>
                Mood, anxiety, suicidality screen, trauma, ADHD diagnostic intake. Verbatim
                patient quotes for medicolegal record. Structured around safety planning.
              </p>
            </article>
            <article className="tmpl tmpl-emph">
              <span className="tmpl-tag">Long-form</span>
              <h3>Developmental Evaluation</h3>
              <p>
                Long-form autism / developmental eval. M-CHAT, ADOS-style observation, parent
                interview about milestones, social communication, repetitive behaviors. Accepts 1–2
                page notes.
              </p>
            </article>
            <article className="tmpl">
              <span className="tmpl-tag">Mode</span>
              <h3>Dictation</h3>
              <p>Mode-specific for physician-narrated notes. No diarization noise.</p>
            </article>
            <article className="tmpl tmpl-custom">
              <span className="tmpl-tag tmpl-tag-accent">Custom</span>
              <h3>Anything else.</h3>
              <p>
                Type a plain-English description, click <em>Polish with AI</em>. brtlb rewrites it
                in the house style with the full safety scaffolding baked in.
              </p>
            </article>
          </div>
        </section>

        {/* PRIVACY */}
        <section id="privacy" className="privacy section">
          <div className="privacy-head">
            <div>
              <p className="eyebrow eyebrow-light">
                <span className="eyebrow-dot" /> Privacy architecture
              </p>
              <h2 className="hh hh-light">
                No "trust us with your PHI" — because we never have it.
              </h2>
              <p className="body-copy body-light">
                Most AI scribes route your patient audio through their servers, hold it in their
                database, run their pipelines, and ask you to trust their BAA. brtlb has no
                servers.
              </p>
            </div>
          </div>

          <div className="privacy-grid">
            <article className="privacy-card">
              <h3>No SaaS data breach</h3>
              <p>There is no brtlb database to breach. Your visits live on your device.</p>
            </article>
            <article className="privacy-card">
              <h3>No vendor lock-in</h3>
              <p>
                Pull your AssemblyAI and Google keys, the data goes with you. brtlb stops being
                part of your stack the moment you close the tab.
              </p>
            </article>
            <article className="privacy-card">
              <h3>Existing BAAs cover it</h3>
              <p>
                Most peds practices already have Google Workspace HIPAA BAAs. AssemblyAI's BAA
                takes 5 minutes via DocuSign. Done.
              </p>
            </article>
            <article className="privacy-card">
              <h3>Local audit log</h3>
              <p>
                Every meaningful action logged with timestamp + type only. No PHI. Last 200 actions
                visible in Settings.
              </p>
            </article>
            <article className="privacy-card">
              <h3>Auto-delete from vendor</h3>
              <p>
                By default, brtlb tells AssemblyAI to delete each transcript and audio immediately
                after the result is pulled. Days → seconds.
              </p>
            </article>
            <article className="privacy-card">
              <h3>Audio auto-purge</h3>
              <p>
                Local audio blobs purge on a configurable schedule (default 7 days). Transcript
                and note kept; raw audio gone.
              </p>
            </article>
            <article className="privacy-card">
              <h3>Idle auto-lock</h3>
              <p>
                UI hides PHI behind a tap-to-continue screen after configurable inactivity (default
                5 min).
              </p>
            </article>
            <article className="privacy-card privacy-wipe">
              <h3>Wipe all data</h3>
              <p>
                Single button drops every recording, transcript, note, key, audit-log entry, and
                setting. No undo.
              </p>
              <span className="wipe-button" aria-hidden="true">
                Wipe all
              </span>
            </article>
          </div>
        </section>

        {/* RESILIENCE */}
        <section className="interrupt section">
          <div className="interrupt-grid">
            <div>
              <p className="eyebrow">
                <span className="eyebrow-dot" /> Built for the long visit
              </p>
              <h2 className="hh">Resilience baked in.</h2>
              <p className="body-copy">
                Pediatric visits run long. Wifi gets flaky. Phones come in and out of pockets.
                brtlb is built so the recording keeps going and you always know exactly where you
                stand.
              </p>
            </div>
            <div className="interrupt-detail">
              <ul className="signal-list">
                <li>
                  <code>Wake&nbsp;Lock</code>
                  <span>holds the screen on for the full visit, automatically</span>
                </li>
                <li>
                  <code>auto-save</code>
                  <span>every second of audio persists locally as it's recorded</span>
                </li>
                <li>
                  <code>adaptive&nbsp;timeout</code>
                  <span>upload window scales with file size for slow clinic WiFi</span>
                </li>
                <li>
                  <code>chapter&nbsp;markers</code>
                  <span>3–7 named segments auto-generated for visits ≥30 min</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* COSTS */}
        <section className="cost section">
          <div className="cost-grid">
            <div className="cost-pitch">
              <p className="eyebrow">
                <span className="eyebrow-dot" /> Costs
              </p>
              <h2 className="hh">~$0.20 per visit. No markup.</h2>
              <p className="body-copy">
                brtlb itself is free. You pay your vendors directly. There is no SaaS layer added
                on top of the underlying compute.
              </p>
            </div>
            <div className="cost-card">
              <div className="cost-row">
                <span className="cost-label">AssemblyAI · 15-min visit</span>
                <span className="cost-val">~$0.16</span>
              </div>
              <div className="cost-row">
                <span className="cost-label">Google Gemini · note generation</span>
                <span className="cost-val">&lt;$0.01</span>
              </div>
              <div className="cost-row cost-row-total">
                <span className="cost-label">Total per visit</span>
                <span className="cost-val cost-val-big">~$0.17–0.20</span>
              </div>
              <hr />
              <p className="cost-foot">
                For comparison: Heidi at $99/month is roughly $0.50/visit at 200 visits/month.
                Abridge enterprise is $300+/month.
              </p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="faq section">
          <div className="section-head">
            <p className="eyebrow">
              <span className="eyebrow-dot" /> Frequently asked
            </p>
            <h2 className="hh">Honest answers, including the limitations.</h2>
          </div>
          <div className="faq-list">
            <details>
              <summary>What's an API key — and why does brtlb need two?</summary>
              <div className="faq-body">
                <p>
                  An API key is a long secret string (think of it as a password) that lets a piece
                  of software talk to a vendor's service on your behalf. You generate it once on
                  the vendor's website and paste it into brtlb. We store it locally in your
                  browser; it never leaves your device.
                </p>
                <p>brtlb uses two:</p>
                <ul>
                  <li>
                    <strong>AssemblyAI</strong> — turns your audio recording into a transcript with
                    speaker labels. Sign up at <code>assemblyai.com</code>, sign their BAA, and
                    copy the key from your dashboard. You pay them ~$0.12 per visit.
                  </li>
                  <li>
                    <strong>One LLM provider key</strong> — your choice. Default is OpenAI
                    GPT-5-mini (~$0.01 per visit; matched the heavier models on note quality in
                    our pediatric-fixture eval). Google Gemini 3.1 Pro is an equally-supported
                    alternate (~$0.02 per visit) if you're already on Google Workspace. Claude
                    Sonnet is available via Vertex AI or AWS Bedrock for practices that want it
                    — see the docs.
                  </li>
                </ul>
                <p>
                  "Bring your own keys" means <em>you</em> hold the contracts, <em>you</em> see the
                  bills, and <em>you</em> can revoke access at any time. brtlb sits between the
                  keys and the templates — we're not a billable middleman.
                </p>
              </div>
            </details>
            <details>
              <summary>Is brtlb HIPAA compliant?</summary>
              <div className="faq-body">
                <p>
                  brtlb is software that helps you generate HIPAA-compliant documentation, not a
                  HIPAA-covered entity itself. Compliance comes from the vendors in your data path
                  having BAAs:
                </p>
                <ul>
                  <li>
                    <strong>AssemblyAI:</strong> free 5-minute DocuSign BAA
                  </li>
                  <li>
                    <strong>OpenAI (recommended):</strong> email{' '}
                    <code>baa@openai.com</code> for an individual API customer BAA — no
                    Enterprise tier required, 1–3 business days
                  </li>
                  <li>
                    <strong>Google Gemini (alternate):</strong> covered by your Google Workspace
                    HIPAA BAA when the key comes from a billing-enabled Cloud project
                  </li>
                </ul>
                <p>
                  brtlb itself never holds your PHI — there's no brtlb cloud — so there's no brtlb
                  BAA to sign. Full BAA decision tree in the{' '}
                  <a href="/docs/">docs</a>.
                </p>
              </div>
            </details>
            <details>
              <summary>Which provider should I pick?</summary>
              <div className="faq-body">
                <p>
                  The default is <strong>OpenAI GPT-5-mini</strong>. It matched the heavier models
                  (Claude Sonnet, GPT-5, Gemini 3.1 Pro) on note quality in our 48-note
                  pediatric-fixture eval, at roughly 1/6 the cost. The BAA path is also the
                  lowest-friction one: email <code>baa@openai.com</code>, get a 1-page individual
                  API BAA back in 1–3 business days, paste your key.
                </p>
                <p>
                  <strong>Google Gemini 3.1 Pro</strong> is a fully-supported alternate. Pick it
                  if you're already on Google Workspace with the HIPAA BAA accepted — the GCP
                  path may have less friction for practices already invested in Workspace.
                </p>
                <p>
                  <strong>Claude Sonnet</strong> wins by a small margin on the hardest fixtures
                  (behavioral health, deliberation-heavy decisions), but the setup is heavier —
                  see <a href="/docs/advanced-providers.html">Advanced Providers</a> for Google
                  Vertex AI and AWS Bedrock paths.
                </p>
              </div>
            </details>
            <details>
              <summary>Can I use brtlb with Anthropic / Claude direct?</summary>
              <div className="faq-body">
                <p>
                  Not direct (yet). Anthropic Enterprise/BAA accounts block browser CORS requests
                  as part of their custom-retention security model, which makes direct
                  browser-to-Claude calls impossible. The Anthropic adapter is in the codebase
                  for when this changes (or for the future native iOS shell that bypasses CORS),
                  but the direct provider is hidden from the picker today.
                </p>
                <p>
                  Two browser-direct workarounds work today: <strong>Claude on Google Vertex AI</strong>{' '}
                  (covered by your existing Google Workspace HIPAA BAA) and <strong>Claude on
                  AWS Bedrock</strong> (covered by your AWS BAA). Setup for both is documented at{' '}
                  <a href="/docs/advanced-providers.html">/docs/advanced-providers</a>.
                </p>
              </div>
            </details>
            <details>
              <summary>Does brtlb work on my phone?</summary>
              <div className="faq-body">
                <p>
                  Yes. brtlb is a Progressive Web App. On iPhone, open <code>brtlb.io</code> in
                  Safari and tap <strong>Share → Add to Home Screen</strong>. On Android, open in
                  Chrome and tap <strong>Install app</strong>.
                </p>
                <p>
                  <strong>iOS caveat:</strong> browser-based recording stops when the phone screen
                  locks. brtlb shows a clear advisory and detects screen-lock interruptions
                  deterministically. A native iOS app (Capacitor wrap) is on the roadmap to remove
                  this limitation — until then, keep the screen on.
                </p>
              </div>
            </details>
            <details>
              <summary>Can I sync recordings across devices?</summary>
              <div className="faq-body">
                <p>
                  No, deliberately. Each device + browser context is its own data island. There is
                  no brtlb cloud to sync through. Use Copy / AirDrop / Email / Save-to-Files to
                  move a note manually.
                </p>
              </div>
            </details>
            <details>
              <summary>What happens if my AssemblyAI account expires?</summary>
              <div className="faq-body">
                <p>
                  brtlb's classified errors will show:{' '}
                  <em>
                    "AssemblyAI: account out of credit or payment failed. Top up at
                    assemblyai.com/dashboard/account to continue."
                  </em>{' '}
                  Top up, refresh brtlb, you're recording again. Existing recordings on your
                  device are unaffected.
                </p>
              </div>
            </details>
            <details>
              <summary>What's coming next?</summary>
              <div className="faq-body">
                <ul>
                  <li>Capacitor native iOS app (resumes the screen-lock case)</li>
                  <li>Personalization layer (your voice / boilerplate / signoff applied to every note)</li>
                  <li>Multi-vendor STT failover (Google Cloud STT as automatic backup)</li>
                  <li>Practice analytics (visit type breakdown, time saved, cost analysis)</li>
                  <li>Premium templates library for paid Pro tier</li>
                </ul>
              </div>
            </details>
          </div>
        </section>

        {/* CTA */}
        <section id="try" className="cta section">
          <div className="cta-card">
            <div className="cta-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <h2 className="display cta-title">Five minutes to your first note.</h2>
            <p className="lede cta-lede">
              Bring your own AssemblyAI and Google Gemini keys. The wizard walks you through
              getting them with live verification of each before you advance. Two keys. ~$0.20 a
              visit. No subscription.
            </p>
            <div className="cta-actions">
              <a className="button primary big" href="#try" onClick={launchApp}>
                Launch brtlb →
              </a>
              <a className="button ghost big" href="#how" onClick={scrollToAnchor}>
                Read the architecture
              </a>
            </div>
            <p className="cta-foot">
              Two API keys, five minutes of setup. Your existing BAAs cover the data flow.
            </p>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="footer-top">
          <div className="footer-brand">
            <span className="brand-dots brand-dots-lg" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="footer-word">brtlb</span>
            <p className="footer-tag">Less noise. Same meaning.</p>
          </div>
          <div className="footer-cols">
            <div className="footer-col">
              <p className="footer-col-head">Product</p>
              <a href="#why" onClick={scrollToAnchor}>Who it's for</a>
              <a href="#how" onClick={scrollToAnchor}>How it works</a>
              <a href="#templates" onClick={scrollToAnchor}>Templates</a>
              <a href="#privacy" onClick={scrollToAnchor}>Privacy</a>
            </div>
            <div className="footer-col">
              <p className="footer-col-head">Docs</p>
              <a href="/docs/">Documentation home</a>
              <a href="/docs/features.html">Features</a>
              <a href="/docs/customize.html">Customize</a>
              <a href="/docs/troubleshoot.html">Troubleshooting</a>
              <a href="/docs/faq.html">FAQ (full)</a>
              <a href="/docs/advanced-providers.html">Advanced providers</a>
            </div>
            <div className="footer-col">
              <p className="footer-col-head">Read more</p>
              <a href="#faq" onClick={scrollToAnchor}>FAQ</a>
              <a href="/docs/why.html">Why brtlb</a>
            </div>
            <div className="footer-col">
              <p className="footer-col-head">Get started</p>
              <a href="#try" onClick={launchApp}>
                Try it
              </a>
              <a href="/docs/">Setup guide</a>
              <a href="/docs/">BAA decision tree</a>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <p>© 2026 brtlb</p>
          <p>Built by a pediatric DPC physician. For pediatric DPC physicians.</p>
        </div>
      </footer>
    </>
  );
}
