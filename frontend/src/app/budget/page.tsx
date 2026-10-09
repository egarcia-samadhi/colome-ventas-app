import { AppShell } from "@/components/AppShell";
import { Placeholder } from "@/components/Placeholder";

export default function BudgetPage() {
  return (
    <AppShell current="/budget/" title="Budget">
      <Placeholder
        icon="💰"
        titulo="Budget"
        detalle="Esta sección todavía no está disponible — se habilita cuando haya presupuesto real de Colomé para cargar (por período y detalle País/Marca/Canal)."
      />
    </AppShell>
  );
}
