import { AppShell } from "@/components/AppShell";
import { getCurrentCompany } from "@/lib/company";
import { ImportForms } from "./ImportForms";

export default async function ImportarPage() {
  const { company, userId: _userId } = await getCurrentCompany();

  return (
    <AppShell companyName={company.name} activePath="/importar">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Importar conversas</h1>
      <p className="mb-8 max-w-xl text-sm text-text-muted">
        Traga as conversas comerciais da sua empresa — por CSV ou colando uma conversa avulsa — e o
        VAZOU.AI identifica automaticamente o que está parado e por quê.
      </p>
      <ImportForms companyId={company.id} />
    </AppShell>
  );
}
