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
> 2. On the home screen, click **"Try the built-in sample (no document
>    needed)"**. It opens a built-in, fully analyzed fictional sample
>    document.
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
> labeled "optional".
>
> The user interface follows the language of the OS: it renders in English on
> an English Windows install, so the labels above appear in English for the
> tester. Settings also offers an explicit language picker (Auto / 日本語 /
> English).
>
> Product ID: 9NLL16SBKGDW
