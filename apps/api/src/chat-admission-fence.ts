/**
 * One conversation-wide admission fence for every command that can install a
 * prepared skill extension and reach native submit: ordinary Send, original
 * Retry and New Send. It is reject-not-queue and is held from preparation
 * through acceptance or definite rejection, so two commands can never both see
 * native idle and replace the running registry.
 */
export class ChatAdmissionFence {
  private held = false;

  get isHeld(): boolean {
    return this.held;
  }

  tryEnter(): boolean {
    if (this.held) return false;
    this.held = true;
    return true;
  }

  leave(): void {
    this.held = false;
  }
}
