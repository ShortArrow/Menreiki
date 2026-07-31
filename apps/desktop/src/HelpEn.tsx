import {
  BadgeCheck,
  FileText,
  PenLine,
  Printer,
  ScanSearch,
} from "./icons";

/// English help prose, mirroring HelpJa section for section.
export default function HelpEn() {
  return (
    <>
      <h2>What does Menreiki do?</h2>
      <p>
        It marks the words in a document (PDF or image) that you may not want
        to show anyone else — company names, personal names, model numbers,
        addresses, phone numbers — and, <b>after you confirm each one</b>,
        produces a new PDF with them blacked out, erased, or replaced by
        different wording. <b>The original file is never modified.</b>{" "}
        Everything happens on this computer; nothing is sent anywhere.
      </p>

      <div className="help-flow simple">
        <div className="row">
          <span className="node">
            <FileText size={15} /> Import a document
          </span>
          <span className="arrow-h">→</span>
          <span className="node">
            <ScanSearch size={15} /> Analysis marks candidates
          </span>
          <span className="arrow-h">→</span>
          <span className="node strong">
            <PenLine size={15} /> You decide
          </span>
          <span className="arrow-h">→</span>
          <span className="node">
            <Printer size={15} /> Apply and export
          </span>
          <span className="arrow-h">→</span>
          <span className="node">
            <BadgeCheck size={15} /> Check for leftovers
          </span>
        </div>
      </div>

      <h2>Four ways to decide</h2>
      <p>For every candidate word, you pick one of these.</p>
      <div className="decide-demo">
        <div className="decide-item">
          <span className="demo-before">secret</span>
          <span className="arrow-h">→</span>
          <span className="demo-after keep">secret</span>
          <span className="decide-label">Keep (leave as is)</span>
        </div>
        <div className="decide-item">
          <span className="demo-before">secret</span>
          <span className="arrow-h">→</span>
          <span className="demo-after mask">██</span>
          <span className="decide-label">Mask (black out)</span>
        </div>
        <div className="decide-item">
          <span className="demo-before">secret</span>
          <span className="arrow-h">→</span>
          <span className="demo-after erase"> </span>
          <span className="decide-label">Erase (leave no trace)</span>
        </div>
        <div className="decide-item">
          <span className="demo-before">secret</span>
          <span className="arrow-h">→</span>
          <span className="demo-after replace">Alias A</span>
          <span className="decide-label">Replace (reword)</span>
        </div>
      </div>

      <h2>The key idea — one alias per subject (Entity)</h2>
      <div className="entity-demo">
        <div className="entity-demo-sources">
          <span className="demo-before">Alpha Giken Inc.</span>
          <span className="demo-before">Alpha Giken</span>
          <span className="demo-before">Alpha</span>
        </div>
        <span className="arrow-h big">→</span>
        <span className="node strong">Entity</span>
        <span className="arrow-h big">→</span>
        <span className="demo-after replace">all become "Developer A"</span>
      </div>
      <p>
        When different spellings refer to the same subject, grouping them into
        an entity gives them one alias across the whole document. The reader
        still sees that it is the same company throughout, but not which
        company it is.
      </p>

      <h2>The basics (5 steps)</h2>
      <ol className="help-steps">
        <li>
          <b>Press "Run analysis"</b> — the app reads the document and puts an{" "}
          <b>orange outline</b> around words that probably should be hidden.
        </li>
        <li>
          <b>Work down the "Candidates" list on the right</b> — decide each
          word with the buttons. <b>Keep</b> = leave it / <b>Mask</b> = black
          out / <b>Erase</b> = white out, no trace / <b>Replace</b> = swap in
          different wording. A word marked by mistake can be dropped with{" "}
          <b>"Ignore"</b>.
        </li>
        <li>
          <b>Press "Apply"</b> — your decisions are painted onto the pages.
          "Show the result" in the toolbar previews the outcome.
        </li>
        <li>
          <b>Press "Export PDF"</b> — a new PDF is written (Markdown and
          images are available too).
        </li>
        <li>
          <b>Press "Audit"</b> — the app reads the result back and checks that
          nothing you removed is still there.
        </li>
      </ol>

      <h2>Recipes by task</h2>
      <table className="help-table">
        <tbody>
          <tr>
            <th>Hide a word the app did not find</th>
            <td>
              Type it into "Search the text" on the right and turn a hit into a
              rule. If you can see where it is on the page, drawing around it
              with "Rectangle: <b>Detect here</b>" works just as well.
            </td>
          </tr>
          <tr>
            <th>
              The same company appears in several spellings
              <br />
              (Alpha Giken Inc. / Alpha Giken / Alpha)
            </th>
            <td>
              Use "E" on the candidate row to register an <b>entity</b> (one
              subject, many spellings). Every spelling becomes the{" "}
              <b>same alias</b> (for example Developer A) across the document,
              so the relationships survive but the identity does not.
            </td>
          </tr>
          <tr>
            <th>Remove a logo, a seal, or text inside a figure</th>
            <td>
              Drag around it with "Rectangle: <b>Erase</b> or <b>Mask</b>".
              That works on <b>coordinates</b> rather than text, so it covers
              artwork OCR cannot read. For a header that sits in the same place
              on every page, choose "All pages" to do them all at once.
            </td>
          </tr>
          <tr>
            <th>Find a recurring company name automatically next time</th>
            <td>
              Use "Add to the dictionary". It becomes a candidate
              automatically in later analyses.
            </td>
          </tr>
          <tr>
            <th>See what will change before applying</th>
            <td>
              Expanding a pending rule shows a <b>before → after</b> crop for
              every occurrence. Clicking one jumps to that spot. "Overlay
              pending changes" above the viewer previews them on the page
              itself.
            </td>
          </tr>
          <tr>
            <th>Review what was applied</th>
            <td>
              "Result" lists the before → after crops. Clicking one jumps to
              that spot.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Glossary</h2>
      <table className="help-table">
        <tbody>
          <tr>
            <th>Candidates</th>
            <td>
              Words the app <b>suggests</b> hiding. They are suggestions only —
              you decide which ones to act on.
            </td>
          </tr>
          <tr>
            <th>Entity</th>
            <td>
              A container for "different spellings, same subject". Every
              spelling in it is replaced by a single alias.
            </td>
          </tr>
          <tr>
            <th>Dictionary</th>
            <td>Words you want found automatically in this project.</td>
          </tr>
          <tr>
            <th>Pending rules</th>
            <td>
              The work list that "Apply" executes. Decisions, entities,
              searches, and drawn regions all end up here.
            </td>
          </tr>
          <tr>
            <th>Audit</th>
            <td>
              A final check that reads the output back and looks for leftovers.
              Even on Pass, give the result a human read before publishing.
            </td>
          </tr>
          <tr>
            <th>OCR</th>
            <td>
              Reading text out of an image (the same recognition a copier
              does). It makes mistakes, so a candidate's text is sometimes
              slightly clipped.
            </td>
          </tr>
          <tr>
            <th>LLM / VLM detection</th>
            <td>
              An optional assist that shows the text or the page image to a
              local AI (running on this PC) and asks what was missed. Results
              only appear as candidates; nothing is removed on its own.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Reading the screen</h2>
      <table className="help-table">
        <tbody>
          <tr>
            <th>Left: pages</th>
            <td>
              Colored marks on a thumbnail are the approximate positions of
              candidates and regions (toggled with "Positions" above). An
              orange dot means the page has candidates.
            </td>
          </tr>
          <tr>
            <th>Center: the page</th>
            <td>
              Orange outline = candidate (clicking it highlights the matching
              row on the right); purple outline = search hit. Ctrl+wheel
              zooms, and "Scroll to change pages" turns the wheel into page
              navigation.
            </td>
          </tr>
          <tr>
            <th>Right: the work list</th>
            <td>
              Top to bottom: "Before you export (what is left) → Search →
              Candidates → Entities → Pending rules → Dictionary → Result" —
              the same order as the workflow.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Good to know</h2>
      <ul>
        <li>The original PDF or image is only read, never rewritten.</li>
        <li>
          The exported PDF is rebuilt from the transformed <b>images alone</b>,
          so text can never survive underneath a blacked-out box.
        </li>
        <li>
          Everything runs on this PC. Nothing is sent over the network.
        </li>
        <li>
          Your decisions and drawn regions are saved automatically. You can
          close the app and pick up where you left off.
        </li>
        <li>
          <b>The project folder (.menreiki) is itself confidential.</b> It
          holds a copy of the original and the full recognized text, so keep it
          separate from the exported PDF and delete it deliberately when you no
          longer need it.
        </li>
        <li>
          Whether the output is safe to publish is always a human decision. A
          passing audit confirms that the checks you configured found nothing —
          it is not proof of safety.
        </li>
      </ul>

      <h2>How it works (only if you want the detail)</h2>

      <details className="help-details">
        <summary>Data flow (the whole picture)</summary>
        <p>
          Everything you do converges on the <b>pending rules</b>.
        </p>
        <div className="help-flow">
          <div className="row">
            <span className="node">
              Automatic detection (analysis, dictionary, LLM/VLM)
            </span>
            <span className="node">Search</span>
            <span className="node">Detect here (rectangle)</span>
          </div>
          <span className="arrow">↓ becomes a candidate</span>
          <div className="row">
            <span className="node strong">Candidates</span>
          </div>
          <span className="arrow">
            ↓ decide (keep/mask/erase/replace) or merge into an entity
          </span>
          <div className="row">
            <span className="node">Entity (spellings → alias)</span>
            <span className="node">Search rules</span>
            <span className="node">Region rules (erase/mask rectangles)</span>
          </div>
          <span className="arrow">↓ converge</span>
          <div className="row">
            <span className="node strong">Pending rules</span>
          </div>
          <span className="arrow">↓ the Apply button</span>
          <div className="row">
            <span className="node">Transformed page images</span>
          </div>
          <span className="arrow">↓</span>
          <div className="row">
            <span className="node">PDF / Markdown / image export</span>
            <span className="node">Audit (re-read to find leftovers)</span>
          </div>
          <span className="arrow">↓</span>
          <div className="row">
            <span className="node strong">Result</span>
          </div>
        </div>
      </details>

      <details className="help-details">
        <summary>The grouping model (what an action affects)</summary>
        <p>Granularity nests in three levels.</p>
        <div className="help-tree">
          <div className="tree-node level-0">
            <span className="tree-tag entity-tag">Entity</span>
            "Developer A" — a bundle of spellings, replaced by one alias
          </div>
          <div className="tree-node level-1">
            <span className="tree-tag group-tag">Candidate group</span>
            category × text (organization × "Alpha Giken Inc.")
          </div>
          <div className="tree-node level-2">
            <span className="tree-tag occ-tag">Occurrence</span> p.1 — one
            positioned hit (one rectangle in the main view)
          </div>
          <div className="tree-node level-2">
            <span className="tree-tag occ-tag">Occurrence</span> p.4
          </div>
          <div className="tree-node level-1">
            <span className="tree-tag group-tag">Candidate group</span>
            organization × "Alpha Giken"
          </div>
          <div className="tree-node level-2">
            <span className="tree-tag occ-tag">Occurrence</span> p.2
          </div>
        </div>
        <table className="help-table">
          <tbody>
            <tr>
              <th>Occurrence</th>
              <td>
                One hit with a position and text. The unit for jumping and for
                crops.
              </td>
            </tr>
            <tr>
              <th>Candidate group</th>
              <td>
                Every occurrence sharing "category × text". Its identity is the
                pair, with no position, so one row in the candidate list is one
                group and "p.3+2" means it also appears on other pages.{" "}
                <b>
                  Deciding, ignoring, and "into existing" apply to the whole
                  document
                </b>{" "}
                (use a mask region when you want to treat a single spot).
              </td>
            </tr>
            <tr>
              <th>Entity</th>
              <td>
                The top level, bundling several candidate groups into one
                alias.
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          When several instructions cover the same text they collapse into one
          (priority: <b>entity &gt; candidate decision &gt; search rule</b>).
        </p>
      </details>

      <details className="help-details">
        <summary>State transitions of detected data (position and text)</summary>
        <p>
          A piece of detected data carries a{" "}
          <span className="inline-badge pos">position</span> and{" "}
          <span className="inline-badge txt">text</span>. Here is which state
          keeps which, where one is dropped, and when it is resolved again.
        </p>
        <div className="help-flow">
          <div className="row">
            <span className="node">
              Page image<span className="badge pos">position</span>
            </span>
          </div>
          <span className="arrow">↓ OCR</span>
          <div className="row">
            <span className="node">
              Word boxes<span className="badge pos">position</span>
              <span className="badge txt">text</span>
            </span>
          </div>
          <span className="arrow">
            ↓ automatic detection, detect here, LLM matching
          </span>
          <div className="row">
            <span className="node strong">
              Candidate<span className="badge pos">position</span>
              <span className="badge txt">text</span>
            </span>
            <span className="node">
              VLM, position unresolved
              <span className="badge lost">position</span>
              <span className="badge txt">text</span>
            </span>
          </div>
          <span className="arrow">
            ↓ decision, entity, search, dictionary (position is dropped here)
          </span>
          <div className="row">
            <span className="node">
              Rule / entity spelling / dictionary word
              <span className="badge lost">position</span>
              <span className="badge txt">text</span>
            </span>
            <span className="node">
              Ignore list<span className="badge txt">text × category</span>
            </span>
          </div>
          <span className="arrow">
            ↓ apply = resolving positions again (text match over joined OCR
            plus the rectangles of same-text candidates)
          </span>
          <div className="row">
            <span className="node strong">
              edit<span className="badge pos">position</span>
              <span className="badge txt">transformation</span>
            </span>
          </div>
          <span className="arrow">↓ painted onto the page image</span>
          <div className="row">
            <span className="node">
              Transformed image<span className="badge pos">position</span>
            </span>
          </div>
          <span className="arrow">
            ↓ audit = re-OCR the output and look for leftovers
          </span>
          <div className="row">
            <span className="node">
              Leftover<span className="badge pos">position</span>
              <span className="badge txt">text</span>
            </span>
          </div>
        </div>
        <p>
          The point: rules, entities, and dictionary entries hold{" "}
          <b>text only</b>, and positions are resolved at the moment of
          applying. A position pinned with "Detect here" is honored even when
          OCR misread it. Only VLM candidates with no position cannot be
          applied — draw around them with "Detect here", or cover them with a
          mask region.
        </p>
      </details>

      <details className="help-details">
        <summary>Where each button sends things</summary>
        <table className="help-table convert-table">
          <thead>
            <tr>
              <th>Place and button</th>
              <th>Moves</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Candidate row: keep/mask/erase/replace</th>
              <td>
                <span className="from">Candidates</span> ⟶{" "}
                <span className="to">Pending rules</span>
              </td>
              <td>Click again, or "Undo", to send it back</td>
            </tr>
            <tr>
              <th>Candidate row: E</th>
              <td>
                <span className="from">Candidates</span> ⟶{" "}
                <span className="to">Entity</span>
              </td>
              <td>Every spelling flows on as a replace rule</td>
            </tr>
            <tr>
              <th>Candidate row: ignore</th>
              <td>
                <span className="from">Candidates</span> ⟶{" "}
                <span className="to">Ignore list</span>
              </td>
              <td>Excludes that word × category only; undo it in Settings</td>
            </tr>
            <tr>
              <th>Search: add a … rule</th>
              <td>
                <span className="from">Search term</span> ⟶{" "}
                <span className="to">Pending rules</span>
              </td>
              <td>Becomes a document-wide text rule</td>
            </tr>
            <tr>
              <th>Search: register as an entity</th>
              <td>
                <span className="from">Search term</span> ⟶{" "}
                <span className="to">Entity</span>
              </td>
              <td></td>
            </tr>
            <tr>
              <th>Search / detected bar: add to the dictionary</th>
              <td>
                <span className="from">Word</span> ⟶{" "}
                <span className="to">Dictionary</span> ⟶{" "}
                <span className="to">Candidates</span>
              </td>
              <td>After adding, re-analysis detects it automatically</td>
            </tr>
            <tr>
              <th>Detected bar: mask/erase/replace</th>
              <td>
                <span className="from">Detected text</span> ⟶{" "}
                <span className="to">Pending rules</span>
              </td>
              <td></td>
            </tr>
            <tr>
              <th>Detected bar: into existing</th>
              <td>
                <span className="from">Detected text</span> ⟶{" "}
                <span className="to">An existing candidate group</span>
              </td>
              <td>Joins as a missed occurrence and shares its decision</td>
            </tr>
            <tr>
              <th>Rule row: E</th>
              <td>
                <span className="from">Pending rules</span> ⟶{" "}
                <span className="to">Entity</span>
              </td>
              <td>The original rule or decision is cleared automatically</td>
            </tr>
            <tr>
              <th>Dictionary row: E</th>
              <td>
                <span className="from">Dictionary</span> ⟶{" "}
                <span className="to">Entity</span>
              </td>
              <td>It stays in the dictionary</td>
            </tr>
            <tr>
              <th>Entity: → dictionary</th>
              <td>
                <span className="from">Entity</span> ⟶{" "}
                <span className="to">Dictionary</span>
              </td>
              <td>Adds the main spelling; it stays in the entity</td>
            </tr>
          </tbody>
        </table>
      </details>

      <details className="help-details">
        <summary>Rectangle modes and the re-analysis menu</summary>
        <table className="help-table">
          <tbody>
            <tr>
              <th>None</th>
              <td>
                Drawing off. Clicking a candidate rectangle navigates instead.
              </td>
            </tr>
            <tr>
              <th>Erase / Mask</th>
              <td>
                Drag to create a coordinate-based region rule (independent of
                text). Its scope is "All pages" or "This page".
              </td>
            </tr>
            <tr>
              <th>Detect here</th>
              <td>
                Reads the text inside what you drew (crop recognition → page
                words → VLM, in that order) and pins it as a manual candidate
                at those coordinates. The detected bar can transform it
                immediately, and "Into existing" merges it into an existing
                group as a missed occurrence.
              </td>
            </tr>
            <tr>
              <th>Re-analyze: everything / resume / this page</th>
              <td>
                Choose how much to redo. After changing detectors or the
                dictionary, "Detection only" is fastest (and often runs by
                itself).
              </td>
            </tr>
            <tr>
              <th>Re-analyze: LLM / VLM detection</th>
              <td>
                Optional candidates from the local AI. The VLM looks at page
                images, so it can pick up text inside figures, but a word it
                cannot place ends up with an unresolved position.
              </td>
            </tr>
          </tbody>
        </table>
        <ul>
          <li>Ctrl+wheel: zoom / Shift+wheel: scroll sideways</li>
          <li>Pane borders can be dragged to resize (the width is saved)</li>
          <li>Clicking an active decision button clears the decision</li>
        </ul>
      </details>
    </>
  );
}
