export interface ExampleDashboardStat {
  label: string;
  value: string;
  hint: string;
}

export interface ExampleDashboardProps {
  stats: readonly [ExampleDashboardStat, ExampleDashboardStat];
  stops: readonly string[];
}

// Panel decorativo compartido por la landing y el inicio del distribuidor.
// No consulta datos: muestra una “Vista de ejemplo” explícita para que el
// usuario entienda qué va a ver cuando tenga pedidos y ruta reales.
export function ExampleDashboard({ stats, stops }: ExampleDashboardProps) {
  return (
    <div className="relative rounded-2xl border border-gray-200 bg-white p-4 shadow-xl shadow-gray-200/60">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
          Vista de ejemplo
        </span>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
          Hoy
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {stats.map((stat, index) => (
          <div
            key={stat.label}
            className={
              index === 0
                ? "rounded-xl bg-gray-900 p-3 text-white"
                : "rounded-xl border border-gray-200 p-3"
            }
          >
            <p className={`text-[11px] ${index === 0 ? "text-gray-400" : "text-gray-500"}`}>
              {stat.label}
            </p>
            <p className="mt-1 text-2xl font-semibold">{stat.value}</p>
            <p className={`text-[11px] ${index === 0 ? "text-gray-400" : "text-gray-500"}`}>
              {stat.hint}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-xl border border-gray-200 p-3">
        <p className="text-[11px] font-medium text-gray-500">Ruta de hoy</p>
        <ul className="mt-2 space-y-2">
          {stops.map((stop, index) => (
            <li key={stop} className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-600">
                {index + 1}
              </span>
              <span className="flex-1 text-xs text-gray-700">{stop}</span>
              <span className="h-1.5 w-10 rounded-full bg-gray-100" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
