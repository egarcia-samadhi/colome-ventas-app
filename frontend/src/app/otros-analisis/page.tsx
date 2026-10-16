import { AppShell } from "@/components/AppShell";
import { Placeholder } from "@/components/Placeholder";

// Pedido explícito de Ezequiel (2026-10-16): sacar el desglose por grupo
// (VINOS/INSUMOS/SERVICIOS) que había acá y dejar placeholder -- va a
// adaptar esta hoja a los cuadros que se reportan mensualmente (ver mail a
// Colomé del mismo día), todavía no está definido el formato final. El
// endpoint /api/otros-analisis/desglose-grupo y su lógica en ig_ventas.py
// (incluida la cache de agregado cerrado agregada hoy mismo) quedan sin
// tocar por si se reusan para el cuadro real.
export default function OtrosAnalisisPage() {
  return (
    <AppShell current="/otros-analisis/" title="Otros Análisis">
      <Placeholder
        icon="📎"
        titulo="Otros Análisis"
        detalle="Esta sección todavía no está disponible — se está adaptando al formato de los cuadros que se reportan mensualmente a Colomé."
      />
    </AppShell>
  );
}
