export function Placeholder({ icon, titulo, detalle }: { icon: string; titulo: string; detalle: string }) {
  return (
    <div className="mt-6 bg-white border border-[#ece6d8] rounded-[18px] shadow-[0_2px_10px_rgba(28,24,17,0.05)] p-12 flex flex-col items-center text-center gap-3">
      <div className="text-5xl opacity-70">{icon}</div>
      <h2 className="text-base font-semibold text-[#1c1811]">{titulo}</h2>
      <p className="text-sm text-[#847c68] max-w-md">{detalle}</p>
    </div>
  );
}
