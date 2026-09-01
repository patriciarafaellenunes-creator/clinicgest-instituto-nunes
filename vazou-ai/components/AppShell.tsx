import Link from "next/link";
import { signOut } from "@/lib/actions/auth";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/oportunidades", label: "Radar de Oportunidades" },
  { href: "/importar", label: "Importar" },
  { href: "/configuracoes", label: "Configurações" },
];

export function AppShell({
  children,
  companyName,
  userName,
  activePath,
}: {
  children: React.ReactNode;
  companyName: string;
  userName?: string | null;
  activePath: string;
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 shrink-0 flex-col justify-between border-r border-border bg-surface px-4 py-6">
        <div>
          <div className="mb-1 px-2 text-lg font-bold tracking-tight">
            VAZOU<span className="text-accent">.</span>AI
          </div>
          <p className="mb-6 px-2 text-xs text-text-muted">
            Seu dinheiro não deveria sumir no atendimento.
          </p>

          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const active = activePath.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-accent-soft text-accent"
                      : "text-text-muted hover:bg-surface-2 hover:text-text"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="rounded-lg bg-surface-2 px-3 py-2.5">
            <p className="text-xs text-text-muted">Empresa</p>
            <p className="truncate text-sm font-medium">{companyName}</p>
          </div>
          <div className="flex items-center justify-between px-1">
            <span className="truncate text-sm text-text-muted">{userName ?? "Você"}</span>
            <form action={signOut}>
              <button type="submit" className="text-xs text-text-muted underline hover:text-text">
                Sair
              </button>
            </form>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden px-8 py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
