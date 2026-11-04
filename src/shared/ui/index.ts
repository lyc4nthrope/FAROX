// B3 (T3.2 · D1/D4, obs #486): componentes compartidos de listados.
// sdd/admin-console T-B2: primitiva compartida de listados (D-M1).
export { BarChart, DonutChart, LineChart } from "./charts";
export type {
  BarChartItem,
  BarChartProps,
  BarChartSeries,
  DonutChartProps,
  DonutSlice,
  LineChartProps,
  LineChartSeries,
} from "./charts";
export { DataTable } from "./DataTable/DataTable";
export type { DataTableColumn, DataTableAction } from "./DataTable/DataTable";
export { EmptyState } from "./EmptyState";
export { ErrorBanner } from "./ErrorBanner";
export { SectionIcon } from "./icons";
export { ResponsiveTable } from "./ResponsiveTable";
export type { ResponsiveTableColumn, ResponsiveTableProps } from "./ResponsiveTable";
export { ExampleDashboard } from "./ExampleDashboard";
export type { ExampleDashboardProps, ExampleDashboardStat } from "./ExampleDashboard";
export { PasswordInput } from "./PasswordInput";
export { PremiumLock } from "./PremiumLock";
export type { PremiumLockProps } from "./PremiumLock";
export { PremiumBadge } from "./PremiumBadge";
export type { PremiumBadgeProps } from "./PremiumBadge";
export { ProductPicker } from "./ProductPicker";
export type { ProductPickerOption, ProductPickerProps } from "./ProductPicker";
export { QuantityStepper } from "./QuantityStepper";
