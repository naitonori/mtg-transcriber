export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
) => {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
};

export const button = (label: string, variant: "primary" | "secondary" | "danger" = "secondary") => {
  const styles = {
    primary:
      "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-teal-500 dark:text-zinc-950 dark:hover:bg-teal-400",
    secondary:
      "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800",
    danger:
      "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-500 dark:text-zinc-950 dark:hover:bg-red-400"
  };
  return el("button", styles[variant], label);
};

export const fieldLabel = (text: string) => el("label", "text-sm font-semibold text-slate-800 dark:text-zinc-200", text);

export const select = <T extends string>(options: Array<{ value: T; label: string }>) => {
  const node = el(
    "select",
    "min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-teal-400 dark:focus:ring-teal-900"
  );
  options.forEach((option) => {
    const optionNode = document.createElement("option");
    optionNode.value = option.value;
    optionNode.textContent = option.label;
    node.append(optionNode);
  });
  return node as HTMLSelectElement;
};

export const section = (title: string, description?: string) => {
  const wrapper = el(
    "section",
    "rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-5"
  );
  const header = el("div", "mb-4 space-y-1");
  header.append(el("h2", "text-base font-bold text-slate-950 dark:text-zinc-50", title));
  if (description) {
    header.append(el("p", "text-sm leading-6 text-slate-600 dark:text-zinc-400", description));
  }
  wrapper.append(header);
  return wrapper;
};

export const statusPill = (text: string, tone: "green" | "yellow" | "red" | "blue" = "blue") => {
  const tones = {
    green: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
    yellow: "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200",
    red: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
    blue: "bg-sky-100 text-sky-950 dark:bg-sky-950 dark:text-sky-200"
  };
  return el("span", `inline-flex items-center rounded px-2 py-1 text-xs font-semibold ${tones[tone]}`, text);
};
