/**
 * The page's one way to ask the operator something: a question in its
 * <dialog>, answered with the dialog's own buttons.
 *
 *   new AskDialog({ dialog, text, yes, no })
 *     dialog  the <dialog>, outside the tabs, so no hidden tab can hide it
 *             while it is open.
 *     text    where the question goes.
 *     yes     the button that agrees: each question names its action on it.
 *     no      Cancel, which has the focus as the dialog opens, so a
 *             reflexive Enter does nothing.
 *
 *   ask({ title, text, yes })
 *            show the question: title is the dialog's accessible name, text
 *            the question, yes the agreeing button's label. A promise of
 *            true when that button is pressed; Cancel, Escape, or anything
 *            else that closes the dialog, is false. While a question is
 *            waiting, another is false at once: one question at a time.
 *   open     whether a question is waiting for its answer.
 *
 * Never window.confirm(): desktop Chrome gives its own dialog the focus and
 * sends the window a blur once it has closed, and the blur stands the
 * Driver down (app.js), so a run the operator had just confirmed stopped at
 * once; and the desktop app's browser pane dismisses native dialogs unseen,
 * so a question asked there was answered no before anyone read it.
 */
class AskDialog {
  #dialog;
  #text;
  #yes;

  constructor({ dialog, text, yes, no }) {
    this.#dialog = dialog;
    this.#text = text;
    this.#yes = yes;
    yes.addEventListener("click", () => dialog.close("yes"));
    no.addEventListener("click", () => dialog.close("no"));
  }

  get open() {
    return this.#dialog.open;
  }

  // Escape closes the dialog with no value, which would leave the last
  // answer standing, so that is cleared first.
  ask({ title, text, yes }) {
    const dialog = this.#dialog;
    if (dialog.open) return Promise.resolve(false);
    dialog.setAttribute("aria-label", title);
    this.#text.textContent = text;
    this.#yes.textContent = yes;
    dialog.returnValue = "";
    return new Promise((resolve) => {
      const answered = () => {
        dialog.removeEventListener("close", answered);
        resolve(dialog.returnValue === "yes");
      };
      dialog.addEventListener("close", answered);
      dialog.showModal();
    });
  }
}
