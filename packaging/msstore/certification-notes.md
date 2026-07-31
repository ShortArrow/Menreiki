# Notes for Certification (paste into Partner Center)

Paste the text below into the **Notes for certification** field of the Store
submission. It gives the tester a zero-setup path to the app's primary
functionality, which is what the 10.3.3 "App Is Testable" rejection asked for.

> **Testing this app requires no account, no login, and no external files.**
>
> Menreiki is a local, offline document de-identification tool. All processing
> happens on the device; the app makes no network connections and collects no
> data.
>
> To reach the primary functionality with no setup:
>
> 1. Launch the app.
> 2. On the home screen, click **"サンプルを開いて試す（文書の用意は不要）"**
>    — this is the button labeled "Open the sample to try it (no document
>    needed)". It opens a built-in, fully analyzed fictional sample document.
> 3. The review screen appears: detected candidates (names, organizations,
>    phone numbers, email addresses, etc.) are listed in the right pane and
>    outlined on the page image in the center. Use the left pane to switch
>    between the 3 pages.
> 4. To see a transformation: pick any candidate, choose an action
>    (mask / remove / replace), then click the apply button in the toolbar.
>    The page updates in place.
> 5. To produce output: use the export buttons (PDF / Markdown / images).
>
> **About the "Local LLM" section in the Settings dialog:** this is an
> optional integration with an AI server the user may run themselves on
> their own machine (localhost only). It is NOT required for any
> functionality: every feature above works without it, and no server,
> account, or credentials are needed to test the app. The section is
> labeled 任意 ("optional").
>
> The user interface is Japanese only (the app targets Japanese-language
> documents), so the button labels above are given in Japanese with English
> translations. The sample button on the home screen also carries an
> English caption: "Try the built-in sample (no document needed)".
>
> Product ID: 9NLL16SBKGDW
