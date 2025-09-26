import React, { useEffect, useMemo, useState } from "react";
import AccessGate from "./components/AccessGate";
import Footer from "./components/Footer";

// --- Helper formatting ---
const fmtEUR = (n: number) =>
  isFinite(n) ? n.toLocaleString("fi-FI", { style: "currency", currency: "EUR" }) : "–";
const fmtNum = (n: number, d = 2) =>
  isFinite(n) ? n.toLocaleString("fi-FI", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–";
const pct = (n: number, d = 1) =>
  isFinite(n) ? (n * 100).toLocaleString("fi-FI", { minimumFractionDigits: d, maximumFractionDigits: d }) + " %" : "–";

// --- Default inputs from Excel (Syötteet) ---
const defaultInputs = {
  year: 2025,
  hourly_wage: 20,
  weekly_hours: 40,
  weeks_per_year: 52,
  holiday_weeks: 5,
  pekkaspv_hours: 100,
  sick_days: 7,
  public_holidays_days: 8, // Arkipyhät 2025

  // Sosiaalikulut (prosentit)
  tyel_employer: 0.1738,
  sotu_rate: 0.0187,
  unemployment_rate: 0.0020,
  accident_rate: 0.0054,
  group_life_rate: 0.0006,

  // Suorat €/hlö/v
  workwear_per_head: 300,
  occ_health_per_head: 250,
  tools_per_head: 300,
  car_per_head: 0,
  travel_per_head: 0,
  siteallow_per_head: 0,

  // Jaettavat €/v
  rent_per_month: 6000,
  admin_per_year: 500000,
  num_productive: 42,
  car_pool_total: 0,
  travel_pool_total: 0,
  siteallow_pool_total: 0,

  meal_allowance_per_day: 13.25,
  vat_rate: 0.255,
  utilization: 0.85,
  markup_low: 0.20,
  markup_mid: 0.25,
  markup_high: 0.30,
};

type Inputs = typeof defaultInputs;

function useCalc(v: Inputs) {
  return useMemo(() => {
    const annual_base_salary = v.hourly_wage * v.weekly_hours * v.weeks_per_year; // B3
    const holiday_pay = 0.5 * v.hourly_wage * (v.holiday_weeks * v.weekly_hours); // B4
    const payroll_total = annual_base_salary + holiday_pay; // B5

    const social_total_rate =
      v.tyel_employer + v.sotu_rate + v.unemployment_rate + v.accident_rate + v.group_life_rate; // B7
    const social_costs_eur = payroll_total * social_total_rate; // B8
    const pay_with_social = payroll_total + social_costs_eur; // B9

    const overheads_direct =
      v.workwear_per_head +
      v.occ_health_per_head +
      v.tools_per_head +
      v.car_per_head +
      v.travel_per_head +
      v.siteallow_per_head; // B11

    const overheads_shared =
      ((v.rent_per_month * 12) +
        v.admin_per_year +
        v.car_pool_total +
        v.travel_pool_total +
        v.siteallow_pool_total) /
      v.num_productive; // B12

    const overheads_total = overheads_direct + overheads_shared; // B13

    const attendance_hours_year =
      v.weekly_hours * v.weeks_per_year -
      v.holiday_weeks * v.weekly_hours -
      v.sick_days * 8 -
      v.public_holidays_days * 8 -
      v.pekkaspv_hours; // B17

    const billable_hours_year = attendance_hours_year * v.utilization; // B18

    const meal_allowance_year = v.meal_allowance_per_day * (attendance_hours_year / 8); // B14
    const total_cost_year = pay_with_social + overheads_total + meal_allowance_year; // B15

    const cost_per_billable_hour = total_cost_year / billable_hours_year; // B20
    const pay_plus_social_per_hour = pay_with_social / billable_hours_year; // eriteltyyn listaan

    // Hinnoittelun erittely €/h (G-sarake)
    const bd = [
      { name: "Palkka + sivukulut", value: pay_plus_social_per_hour },
      { name: "Työvaatteet", value: v.workwear_per_head / billable_hours_year },
      { name: "Työterveys", value: v.occ_health_per_head / billable_hours_year },
      { name: "Työkalut", value: v.tools_per_head / billable_hours_year },
      { name: "Ateriakorvaus €/pv", value: v.meal_allowance_per_day / (8 * v.utilization) },
      { name: "Autokalusto/autokulut (hlö)", value: v.car_per_head / billable_hours_year },
      { name: "Matkakorvaukset (hlö)", value: v.travel_per_head / billable_hours_year },
      { name: "Työmaalisät (hlö)", value: v.siteallow_per_head / billable_hours_year },
      { name: "Vuokra (jaettu)", value: (v.rent_per_month * 12) / v.num_productive / billable_hours_year },
      { name: "Hallinto/työnjohto (jaettu)", value: v.admin_per_year / v.num_productive / billable_hours_year },
      { name: "Autokalusto/autokulut (pooli)", value: v.car_pool_total / v.num_productive / billable_hours_year },
      { name: "Matkakorvaukset (pooli)", value: v.travel_pool_total / v.num_productive / billable_hours_year },
      { name: "Työmaalisät (pooli)", value: v.siteallow_pool_total / v.num_productive / billable_hours_year },
    ];
    const breakdown_total = bd.reduce((s, x) => s + (isFinite(x.value) ? x.value : 0), 0);

    const sales_low = cost_per_billable_hour * (1 + v.markup_low);
    const sales_mid = cost_per_billable_hour * (1 + v.markup_mid);
    const sales_high = cost_per_billable_hour * (1 + v.markup_high);

    return {
      annual_base_salary,
      holiday_pay,
      payroll_total,
      social_total_rate,
      social_costs_eur,
      pay_with_social,
      overheads_direct,
      overheads_shared,
      overheads_total,
      attendance_hours_year,
      billable_hours_year,
      meal_allowance_year,
      total_cost_year,
      cost_per_billable_hour,
      pay_plus_social_per_hour,
      breakdown: bd,
      breakdown_total,
      sales_low,
      sales_mid,
      sales_high,
    };
  }, [v]);
}

/* -----------------------------  INPUTS  --------------------------------- */
function NumberInput({
  value,
  onChange,
  readOnly = false,
  className = "",
}: {
  value: number;
  onChange: (n: number) => void;
  readOnly?: boolean;
  className?: string;
}) {
  const [text, setText] = useState<string>(() => String(value ?? ""));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(String(value ?? ""));
  }, [value, focused]);

  const toNum = (s: string) => {
    if (s.trim() === "") return NaN;
    return Number(s.replace(/\s/g, "").replace(/,/g, "."));
  };

  const commit = () => {
    const n = toNum(text);
    onChange(Number.isNaN(n) ? (value ?? 0) : n);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={`border rounded-xl px-3 py-2 text-right ${readOnly ? "bg-zinc-50 text-zinc-600 cursor-not-allowed" : ""} ${className || "w-48 md:w-56"}`}
      value={text}
      readOnly={readOnly}
      onFocus={() => setFocused(true)}
      onChange={(e) => { if (!readOnly) setText(e.target.value); }}
      onBlur={() => { if (!readOnly) { setFocused(false); commit(); } }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
    />
  );
}

function PercentInput({
  valueDecimal,
  onChangeDecimal,
  className = "",
}: {
  valueDecimal: number;
  onChangeDecimal: (n: number) => void;
  className?: string;
}) {
  return (
    <div className={`relative ${className || "w-48 md:w-56"}`}>
      <NumberInput className="w-full pr-7" value={valueDecimal * 100} onChange={(n) => onChangeDecimal(n / 100)} />
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-zinc-600">%</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow p-5">
      <h2 className="text-xl font-semibold mb-4">{title}</h2>
      {children}
    </div>
  );
}

export default function App() {
  const [v, setV] = useState<Inputs>(defaultInputs);
  const r = useCalc(v);
  const [tab, setTab] = useState<"Syötteet" | "Tuntihinta" | "Asentajan tuottavuus">("Tuntihinta");

  const [pv, setPv] = useState({
    billRate: 0,
    hoursPerDay: 8,
    billableHours: 6,
    costPerHour: 0,
    payrollExtrasPct: 0,
    otherCostsPerHour: 0,
  });

  const utilLevels = [1, 0.9, 0.85, 0.8, 0.75, 0.7];
  const helperRows = useMemo(() => {
    return utilLevels.map((lvl) => {
      const kustEh = (r.cost_per_billable_hour || 0) * (v.utilization || 0) / (lvl || 1);
      const p20 = kustEh * (1 + v.markup_low);
      const p25 = kustEh * (1 + v.markup_mid);
      const p30 = kustEh * (1 + v.markup_high);
      const vat = 1 + v.vat_rate;
      return { lvl, kustEh, p20, p20Vat: p20 * vat, p25, p25Vat: p25 * vat, p30, p30Vat: p30 * vat };
    });
  }, [r.cost_per_billable_hour, v.utilization, v.markup_low, v.markup_mid, v.markup_high, v.vat_rate]);

  useEffect(() => {
    const c100 = helperRows[0]?.kustEh ?? 0;
    setPv((s) => ({ ...s, costPerHour: Number((c100 || 0).toFixed(2)) }));
  }, [helperRows]);

  const day = useMemo(() => {
    const revenue = pv.billableHours * pv.billRate;
    const payroll = pv.hoursPerDay * pv.costPerHour;
    const payrollExtras = payroll * (pv.payrollExtrasPct / 100);
    const otherCosts = pv.hoursPerDay * pv.otherCostsPerHour;
    const totalCost = payroll + payrollExtras + otherCosts;
    const lostRevenue = (pv.hoursPerDay - pv.billableHours) * pv.billRate;
    const profit = revenue - totalCost;
    const utilizationDaily = pv.hoursPerDay > 0 ? pv.billableHours / pv.hoursPerDay : 0;
    const marginPerBilledHour = pv.billableHours > 0 ? (revenue - totalCost) / pv.billableHours : 0;
    return { revenue, payroll, payrollExtras, otherCosts, totalCost, lostRevenue, profit, utilizationDaily, marginPerBilledHour };
  }, [pv]);

  const [yearCtl, setYearCtl] = useState({
    workDays: 220,
    targetProfit: 10000,
    materialMarginPct: 0.20,
  });

  const year = useMemo(() => {
    const annualRevenue = day.revenue * yearCtl.workDays;
    const annualCost = day.totalCost * yearCtl.workDays;
    const annualLost = day.lostRevenue * yearCtl.workDays;
    const annualProfit = day.profit * yearCtl.workDays;

    const neededExtraProfit = Math.max(0, yearCtl.targetProfit - annualProfit);
    const neededMaterialSales = yearCtl.materialMarginPct > 0 ? neededExtraProfit / yearCtl.materialMarginPct : 0;
    const neededMaterialPerMonth = neededMaterialSales / 12;
    const neededMaterialPerDay = yearCtl.workDays > 0 ? neededMaterialSales / yearCtl.workDays : 0;

    return {
      annualRevenue,
      annualCost,
      annualLost,
      annualProfit,
      neededExtraProfit,
      neededMaterialSales,
      neededMaterialPerMonth,
      neededMaterialPerDay,
    };
  }, [day, yearCtl]);

  const Field = ({ label, k }: { label: string; k: keyof Inputs }) => (
    <label className="flex items-center justify-between gap-4 py-1">
      <span className="text-sm w-2/3">{label}</span>
      <NumberInput className="w-48 md:w-56" value={v[k] as any} onChange={(n) => setV((s) => ({ ...s, [k]: n }))} />
    </label>
  );
  const PField = ({ label, k, locked = false }: { label: string; k: keyof typeof pv; locked?: boolean }) => (
    <label className="flex items-center justify-between gap-4 py-1">
      <span className="text-sm w-2/3">{label}</span>
      <NumberInput className="w-48 md:w-56" value={(pv as any)[k]} readOnly={locked} onChange={(n) => setPv((s) => ({ ...s, [k]: n }))} />
    </label>
  );

  return (
    <AccessGate>
      <div className="p-6 max-w-6xl mx-auto space-y-4">
        <div className="flex gap-2 mb-2">
          {(["Syötteet", "Tuntihinta", "Asentajan tuottavuus"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-2xl border ${tab === t ? "bg-black text-white" : "bg-white hover:bg-zinc-50"}`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "Syötteet" && (
          <Section title="Syötteet">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="grid grid-cols-1 gap-3">
                <h3 className="font-semibold">Perusparametrit</h3>
                <Field label="Vuosi" k="year" />
                <Field label="Tuntipalkka €/h" k="hourly_wage" />
                <Field label="Työviikko, h" k="weekly_hours" />
                <Field label="Viikkoja vuodessa" k="weeks_per_year" />
                <Field label="Lomaviikot/v" k="holiday_weeks" />
                <Field label="Pekkaspäivät, h/v" k="pekkaspv_hours" />
                <Field label="Sairauspäivät, pv/v" k="sick_days" />
                <Field label="Arkipyhät, pv/v" k="public_holidays_days" />
              </div>
              <div className="grid grid-cols-1 gap-3">
                <h3 className="font-semibold">Sosiaalikulut (prosentit) — syötä desimaalilukuina</h3>
                <Field label="TyEL työnantajan osuus" k="tyel_employer" />
                <Field label="Sairausvakuutusmaksu" k="sotu_rate" />
                <Field label="Työttömyysvakuutusmaksu" k="unemployment_rate" />
                <Field label="Tapaturmavakuutus" k="accident_rate" />
                <Field label="Ryhmähenkivakuutus" k="group_life_rate" />

                <h3 className="font-semibold mt-4">Yleiskulut / asentaja (suorat, €/hlö/v)</h3>
                <Field label="Työvaatteet" k="workwear_per_head" />
                <Field label="Työterveys" k="occ_health_per_head" />
                <Field label="Työkalut" k="tools_per_head" />
                <Field label="Autokalusto/autokulut (hlö)" k="car_per_head" />
                <Field label="Matkakorvaukset (hlö)" k="travel_per_head" />
                <Field label="Työmaalisät (hlö)" k="siteallow_per_head" />

                <h3 className="font-semibold mt-4">Jaettavat kulut</h3>
                <Field label="Vuokra €/kk" k="rent_per_month" />
                <Field label="Hallinto/työnjohto €/v" k="admin_per_year" />
                <Field label="Tuottavaa työtä tekevät, kpl" k="num_productive" />
                <Field label="Autokalusto (pooli) €/v" k="car_pool_total" />
                <Field label="Matkakorvaukset (pooli) €/v" k="travel_pool_total" />
                <Field label="Työmaalisät (pooli) €/v" k="siteallow_pool_total" />
                <h3 className="font-semibold mt-4">Muut</h3>
                <Field label="Ateriakorvaus €/pv" k="meal_allowance_per_day" />
                <Field label="ALV (yleinen) desimaalina" k="vat_rate" />
                <Field label="Laskutusaste (desimaalina)" k="utilization" />
                <Field label="Kate % (alapää, desimaalina)" k="markup_low" />
                <Field label="Kate % (keskitaso, desimaalina)" k="markup_mid" />
                <Field label="Kate % (yläpää, desimaalina)" k="markup_high" />
              </div>
            </div>
          </Section>
        )}

        {tab === "Tuntihinta" && (
          <Section title="Laskelman tulokset (alv 0 %, ellei toisin mainita)">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <div className="flex justify-between py-1"><span>Vuosipalkka (perustunnit)</span><strong>{fmtEUR(r.annual_base_salary)}</strong></div>
                <div className="flex justify-between py-1"><span>Lomarahat (50 % lomapalkasta)</span><strong>{fmtEUR(r.holiday_pay)}</strong></div>
                <div className="flex justify-between py-1"><span>Palkkasumma (sis. lomarahat)</span><strong>{fmtEUR(r.payroll_total)}</strong></div>
                <div className="flex justify-between py-1"><span>Sosiaalikuluprosentti yhteensä</span><strong>{pct(r.social_total_rate)}</strong></div>
                <div className="flex justify-between py-1"><span>Sosiaalikulut €</span><strong>{fmtEUR(r.social_costs_eur)}</strong></div>
                <div className="flex justify-between py-1"><span>Palkka + sivukulut €</span><strong>{fmtEUR(r.pay_with_social)}</strong></div>
                <div className="flex justify-between py-1"><span>Yleiskulut / asentaja (suorat)</span><strong>{fmtEUR(r.overheads_direct)}</strong></div>
                <div className="flex justify-between py-1"><span>Yleiskulut / asentaja (jaetut)</span><strong>{fmtEUR(r.overheads_shared)}</strong></div>
                <div className="flex justify-between py-1"><span>Yleiskulut / asentaja yhteensä</span><strong>{fmtEUR(r.overheads_total)}</strong></div>
                <div className="flex justify-between py-1"><span>Ateriakorvaus vuodessa / asentaja</span><strong>{fmtEUR(r.meal_allowance_year)}</strong></div>
                <div className="flex justify-between py-1"><span>Kokonaiskustannus / asentaja / vuosi</span><strong>{fmtEUR(r.total_cost_year)}</strong></div>
                <div className="flex justify-between py-1"><span>Läsnäolotunnit / vuosi</span><strong>{fmtNum(r.attendance_hours_year, 0)}</strong></div>
                <div className="flex justify-between py-1"><span>Laskutettavat tunnit / vuosi</span><strong>{fmtNum(r.billable_hours_year, 0)}</strong></div>
                <div className="flex justify-between py-1"><span>Kustannus €/laskutettava tunti</span><strong>{fmtEUR(r.cost_per_billable_hour)}</strong></div>

                <div className="mt-6">
                  <div className="font-semibold mb-1">Hinta €/h eri laskutusasteilla — omakustannus & myyntihinnat</div>
                  <div className="overflow-auto">
                    <table className="w-full text-sm border rounded-xl">
                      <thead className="bg-zinc-50">
                        <tr>
                          <th className="text-left p-2 border">Laskutusaste</th>
                          <th className="text-right p-2 border">Kustannus €/h</th>
                          <th className="text-right p-2 border">+20%</th>
                          <th className="text-right p-2 border">+20% (ALV)</th>
                          <th className="text-right p-2 border">+25%</th>
                          <th className="text-right p-2 border">+25% (ALV)</th>
                          <th className="text-right p-2 border">+30%</th>
                          <th className="text-right p-2 border">+30% (ALV)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {helperRows.map((row, i) => (
                          <tr key={i} className="odd:bg-white even:bg-zinc-50">
                            <td className="p-2 border">{pct(row.lvl, 0)}</td>
                            <td className="p-2 text-right border">{fmtEUR(row.kustEh)}</td>
                            <td className="p-2 text-right border">{fmtEUR(row.p20)}</td>
                            <td className="p-2 text-right border">{fmtEUR(row.p20Vat)}</td>
                            <td className="p-2 text-right border">{fmtEUR(row.p25)}</td>
                            <td className="p-2 text-right border">{fmtEUR(row.p25Vat)}</td>
                            <td className="p-2 text-right border">{fmtEUR(row.p30)}</td>
                            <td className="p-2 text-right border">{fmtEUR(row.p30Vat)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="text-xs text-zinc-600 mt-1">
                    Päivälaskurin kenttä <em>Asentajan kustannus €/h</em> lukittuu taulukon 100 % -rivin omakustannukseen (ilman katetta).
                  </div>
                </div>
              </div>

              <div>
                <div className="text-center font-semibold">Hinnoittelun erittely €/h (laskutettaville tunneille)</div>
                <div className="border rounded-xl mt-2">
                  {r.breakdown.map((x, i) => (
                    <div key={i} className="flex justify-between px-3 py-1 border-b last:border-b-0">
                      <span>{x.name}</span>
                      <span>{fmtEUR(x.value)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between px-3 py-2 bg-zinc-50 font-semibold rounded-b-xl">
                    <span>Yhteensä kustannus €/h ({pct(v.utilization, 0)})</span>
                    <span>{fmtEUR(r.breakdown_total)}</span>
                  </div>
                </div>
              </div>
            </div>
          </Section>
        )}

        {tab === "Asentajan tuottavuus" && (
          <div className="space-y-6">
            <Section title="Asentajan tuottavuus – päivä (pv)">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-1">
                  <h3 className="font-semibold mb-2">Syötteet</h3>
                  <PField label="Laskutustunti (alv 0%) €" k="billRate" />
                  <PField label="Työpäivän tunnit (h)" k="hoursPerDay" />
                  <PField label="Laskutettavat tunnit (h)" k="billableHours" />
                  <PField label="Asentajan kustannus €/h (100 % omakustannus, lukittu)" k="costPerHour" locked />
                  <PField label="Sivukulut % palkasta (jos erikseen)" k="payrollExtrasPct" />
                  <PField label="Muut kulut €/h (auto, työkalut ym.)" k="otherCostsPerHour" />
                </div>
                <div className="md:col-span-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-3 rounded-xl border"><div className="text-sm text-zinc-600">Liikevaihto (laskutus)</div><div className="font-semibold">{fmtEUR(day.revenue)}</div></div>
                    <div className="p-3 rounded-xl border"><div className="text-sm text-zinc-600">Palkkakustannus (brutto)</div><div className="font-semibold">{fmtEUR(day.payroll)}</div></div>
                    <div className="p-3 rounded-xl border"><div className="text-sm text-zinc-600">Sivukulut</div><div className="font-semibold">{fmtEUR(day.payrollExtras)}</div></div>
                    <div className="p-3 rounded-xl border"><div className="text-sm text-zinc-600">Muut kulut</div><div className="font-semibold">{fmtEUR(day.otherCosts)}</div></div>
                    <div className="p-3 rounded-xl border"><div className="text-sm text-zinc-600">Työpanoksen kokonaiskustannus</div><div className="font-semibold">{fmtEUR(day.totalCost)}</div></div>
                    <div className={"p-3 rounded-xl border "}><div className="text-sm text-zinc-600">Laskuttamaton aika – menetetty liikevaihto</div><div className={"font-semibold " + (day.lostRevenue !== 0 ? "text-red-600" : "")}>{fmtEUR(day.lostRevenue)}</div></div>
                    <div className={"p-3 rounded-xl border "}><div className="text-sm text-zinc-600">Katteet euroina</div><div className={"font-semibold " + (day.profit < 0 ? "text-red-600" : "")}>{fmtEUR(day.profit)}</div></div>
                  </div>
                </div>
              </div>
            </Section>

            <Section title="Asentajan tuottavuus – vuosi">
              <div className="grid grid-cols-1 gap-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="md:col-span-1">
                    <h3 className="font-semibold mb-2">Syötteet</h3>
                    <label className="flex items-center justify-between gap-4 py-1">
                      <span className="text-sm w-2/3">Työpäivät vuodessa</span>
                      <NumberInput className="w-48 md:w-56" value={yearCtl.workDays} onChange={(n) => setYearCtl((s) => ({ ...s, workDays: n }))} />
                    </label>
                    <label className="flex items-center justify-between gap-4 py-1">
                      <span className="text-sm w-2/3">Tavoitekate € vuodessa</span>
                      <NumberInput className="w-48 md:w-56" value={yearCtl.targetProfit} onChange={(n) => setYearCtl((s) => ({ ...s, targetProfit: n }))} />
                    </label>
                    <label className="flex items-center justify-between gap-4 py-1">
                      <span className="text-sm w-2/3">Materiaalikate %</span>
                      <div className="min-w-[12rem]"><NumberInput className="w-full" value={yearCtl.materialMarginPct * 100} onChange={(n) => setYearCtl((s) => ({ ...s, materialMarginPct: n/100 }))} /></div>
                    </label>
                  </div>
                  <div className="md:col-span-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-3 rounded-xl border"><div className="text-sm text-zinc-600">Vuotuinen liikevaihto €</div><div className="font-semibold">{fmtEUR(year.annualRevenue)}</div></div>
                      <div className="p-3 rounded-xl border"><div className="text-sm text-zinc-600">Vuotuiset kustannukset €</div><div className="font-semibold">{fmtEUR(year.annualCost)}</div></div>
                      <div className="p-3 rounded-xl border"><div className="text-sm text-zinc-600">Vuotuinen laskuttamaton liikevaihto €</div><div className="font-semibold">{fmtEUR(year.annualLost)}</div></div>
                      <div className={"p-3 rounded-xl border "}><div className="text-sm text-zinc-600">Vuotuinen kate €</div><div className={"font-semibold " + (year.annualProfit < 0 ? "text-red-600" : "")}>{fmtEUR(year.annualProfit)}</div></div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border p-4 bg-zinc-50">
                  <h3 className="font-semibold mb-3">Tarvittava materiaalimyynti katteen saavuttamiseksi</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-3 rounded-xl border bg-white">
                      <div className="text-sm text-zinc-600">Tarvittava lisäkate €</div>
                      <div className="font-semibold">{fmtEUR(year.neededExtraProfit)}</div>
                    </div>
                    <div className="p-3 rounded-xl border bg-white">
                      <div className="text-sm text-zinc-600">Tarvittava materiaalimyynti € (valitulla katteella)</div>
                      <div className="font-semibold">{fmtEUR(year.neededMaterialSales)}</div>
                    </div>
                    <div className="p-3 rounded-xl border bg-white">
                      <div className="text-sm text-zinc-600">Tarvittava materiaalimyynti €/kk</div>
                      <div className="font-semibold">{fmtEUR(year.neededMaterialPerMonth)}</div>
                    </div>
                    <div className="p-3 rounded-xl border bg-white md:col-span-2">
                      <div className="text-sm text-zinc-600">Tarvittava materiaalimyynti €/pv</div>
                      <div className="font-semibold">{fmtEUR(year.neededMaterialPerDay)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </Section>
          </div>
        )}

        <Footer />
      </div>
    </AccessGate>
  );
}
