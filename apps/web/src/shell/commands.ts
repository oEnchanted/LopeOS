import type { Command, CommandRegistry } from '../../../../packages/contracts/src';
export class Commands implements CommandRegistry {
  private commands = new Map<string, Command>();
  register(command: Command) { this.commands.set(command.id, command); return () => { if (this.commands.get(command.id) === command) this.commands.delete(command.id); }; }
  get(id: string) { return this.commands.get(id); }
  list() { return [...this.commands.values()]; }
  async execute(id: string) { const command = this.get(id); if (!command) return; const enabled = typeof command.enabled === 'function' ? command.enabled() : command.enabled; if (enabled !== false) await command.execute(); }
}
