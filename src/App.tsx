import React, { useMemo, useState, useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  Plus,
  CalendarDays,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  ArrowLeft,
  Gauge,
  Info,
} from "lucide-react";
import {
  RadialBarChart,
  RadialBar,
  ResponsiveContainer,
  PolarAngleAxis,
  Tooltip as RechartsTooltip,
  Cell,
} from "recharts";

// ==========================
// Types
// ==========================
export type AssignmentStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "overdue";

export type Assignment = {
  id: string;
  title: string;
  dueDate: string | null; // ISO "YYYY-MM-DD" or null
  weight: number; // user may enter 0–1 or 0–100; we normalize
  status: AssignmentStatus;
  grade: number | null; // 0–100
};

export type Course = {
  id: string;
  name: string;
  assignments: Assignment[];
};

// ==========================
// Helpers
// ==========================
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const clamp = (n: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, n));

// Normalize any weight input: if 0..1 treat as fraction, else percent
function normalizeWeightToPercent(raw: number): number {
  if (!isFinite(raw)) return 0;
  if (raw <= 1) return clamp(raw * 100);
  return clamp(raw);
}

function isPast(dateISO: string | null): boolean {
  if (!dateISO) return false;
  const today = new Date();
  const d = new Date(dateISO + "T23:59:59");
  return d.getTime() < today.getTime();
}

function nextDue(assignments: Assignment[]): Assignment | null {
  const upcoming = assignments
    .filter((a) => a.dueDate && a.status !== "completed")
    .filter((a) => !isPast(a.dueDate!))
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
  return upcoming[0] ?? null;
}

function calcMetrics(course: Course) {
  const weightsCompleted = course.assignments
    .filter((a) => a.status === "completed")
    .reduce((s, a) => s + normalizeWeightToPercent(a.weight), 0);

  const weightedEarned = course.assignments.reduce((s, a) => {
    const w = normalizeWeightToPercent(a.weight);
    const g = a.grade ?? 0; // missing counts as 0 for CurrentMark
    return s + (w * g) / 100; // contributes 0..w
  }, 0);

  const gradeSoFar =
    weightsCompleted > 0
      ? (course.assignments
          .filter((a) => a.status === "completed" && a.grade != null)
          .reduce(
            (s, a) => s + (normalizeWeightToPercent(a.weight) * a.grade!) / 100,
            0
          ) /
          weightsCompleted) *
        100
      : null;

  const currentMark = weightedEarned; // already 0..100
  const completedWeighted = weightsCompleted; // 0..100
  const totalWeights = course.assignments.reduce(
    (s, a) => s + normalizeWeightToPercent(a.weight),
    0
  );

  return { completedWeighted, gradeSoFar, currentMark, totalWeights };
}

// Strip leading zeros except for decimals like 0.5 or the single digit 0
function stripLeadingZerosInput(s: string): string {
  if (s === "") return s;
  if (s[0] === "0" && s.length > 1 && s[1] !== ".") {
    const n = parseFloat(s);
    if (!isNaN(n)) return String(n);
  }
  return s;
}

// ==========================
// Store (Zustand + persist)
// ==========================
interface StoreState {
  courses: Course[];
  addCourse: (name: string) => void;
  renameCourse: (id: string, name: string) => void;
  removeCourse: (id: string) => void;
  addAssignment: (courseId: string, a: Omit<Assignment, "id">) => void;
  updateAssignment: (
    courseId: string,
    aId: string,
    patch: Partial<Assignment>
  ) => void;
  removeAssignment: (courseId: string, aId: string) => void;
}

export const useCourseStore = create<StoreState>()(
  persist(
    (set, get) => ({
      courses: [],
      addCourse: (name) =>
        set((state) => ({
          courses: [...state.courses, { id: uid(), name, assignments: [] }],
        })),
      renameCourse: (id, name) =>
        set((state) => ({
          courses: state.courses.map((c) => (c.id === id ? { ...c, name } : c)),
        })),
      removeCourse: (id) =>
        set((state) => ({ courses: state.courses.filter((c) => c.id !== id) })),
      addAssignment: (courseId, a) =>
        set((state) => ({
          courses: state.courses.map((c) =>
            c.id === courseId
              ? { ...c, assignments: [...c.assignments, { id: uid(), ...a }] }
              : c
          ),
        })),
      updateAssignment: (courseId, aId, patch) =>
        set((state) => ({
          courses: state.courses.map((c) =>
            c.id === courseId
              ? {
                  ...c,
                  assignments: c.assignments.map((a) =>
                    a.id === aId ? { ...a, ...patch } : a
                  ),
                }
              : c
          ),
        })),
      removeAssignment: (courseId, aId) =>
        set((state) => ({
          courses: state.courses.map((c) =>
            c.id === courseId
              ? {
                  ...c,
                  assignments: c.assignments.filter((a) => a.id !== aId),
                }
              : c
          ),
        })),
    }),
    { name: "course-tracker-v1" }
  )
);

// ==========================
// UI Primitives (Tailwind-only)
// ==========================
function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-neutral-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2">
          <h3 className="text-xl font-semibold">{title}</h3>
        </div>
        {children}
      </div>
    </div>
  );
}

function Badge({
  children,
  intent = "default" as "default" | "success" | "danger" | "info",
}) {
  const map: Record<string, string> = {
    default:
      "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100",
    success:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    danger: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
    info: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${map[intent]}`}
    >
      {children}
    </span>
  );
}

function Button({
  children,
  onClick,
  variant = "primary" as "primary" | "ghost" | "outline",
  type = "button",
  className = "",
}) {
  const base =
    "inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium transition shadow-sm";
  const map: Record<string, string> = {
    primary:
      "bg-neutral-900 text-white hover:bg-neutral-800 active:bg-neutral-900 dark:bg-white dark:text-neutral-900",
    ghost: "bg-transparent hover:bg-neutral-100 dark:hover:bg-neutral-800",
    outline:
      "border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800",
  };
  return (
    <button
      type={type}
      className={`${base} ${map[variant]} ${className}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white ${
        props.className ?? ""
      }`}
    />
  );
}

function SelectBox({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
    >
      {children}
    </select>
  );
}

// ==========================
// Charts (Donut with range colors + celebration lap)
// ==========================
function Donut({
  value,
  celebrate = false,
  confetti = true,
}: {
  value: number;
  celebrate?: boolean;
  confetti?: boolean;
}) {
  const v = clamp(value);
  const isHundred = celebrate && v >= 100;
  const domain: [number, number] = isHundred ? [0, 200] : [0, 100];
  const display = isHundred ? 200 : v;

  // Color by range
  const baseColor = v < 50 ? "#FACC15" : v < 80 ? "#38BDF8" : "#22C55E"; // yellow, blue, green
  const lapColor = "#EC4899"; // bright pink for celebration lap

  const [rekey, setRekey] = useState(0);
  useEffect(() => {
    setRekey((k) => k + 1);
  }, [display]);

  const fired = React.useRef(false);
  useEffect(() => {
    if (confetti && celebrate && isHundred && !fired.current) {
      const t = setTimeout(() => {
        import("canvas-confetti")
          .then(({ default: confettiLib }) => {
            confettiLib({
              particleCount: 160,
              spread: 100,
              ticks: 250,
              origin: { x: 0.5, y: 0.5 },
            });
            confettiLib({
              particleCount: 120,
              spread: 120,
              origin: { x: 0.1, y: 0.7 },
            });
            confettiLib({
              particleCount: 120,
              spread: 120,
              origin: { x: 0.9, y: 0.3 },
            });
          })
          .catch(() => {});
      }, 1000);
      fired.current = true;
      const r = setTimeout(() => {
        fired.current = false;
      }, 5000);
      return () => {
        clearTimeout(t);
        clearTimeout(r);
      };
    }
  }, [celebrate, isHundred, confetti]);

  return (
    <div className="h-28 w-28">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          key={rekey}
          innerRadius="60%"
          outerRadius="100%"
          data={[{ name: "done", value: display }]}
          startAngle={90}
          endAngle={-270}
        >
          <PolarAngleAxis type="number" domain={domain} tick={false} />
          <RadialBar
            dataKey="value"
            cornerRadius={8}
            background
            isAnimationActive
            animationDuration={900}
          >
            <Cell fill={isHundred ? lapColor : baseColor} />
          </RadialBar>
          <RechartsTooltip />
        </RadialBarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ==========================
// Components
// ==========================
function TopBar({
  onAddCourse,
  onHome,
}: {
  onAddCourse: () => void;
  onHome?: () => void;
}) {
  return (
    <div className="sticky top-0 z-40 border-b border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-950/80 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onHome}
            className="flex items-center gap-2 hover:opacity-80"
            aria-label="Go to home"
          >
            <BookOpen className="h-5 w-5" />
            <span className="font-semibold">MarkMate</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onAddCourse}>
            <Plus className="h-4 w-4" /> Add Course
          </Button>
        </div>
      </div>
    </div>
  );
}

function CourseCard({
  course,
  onOpen,
}: {
  course: Course;
  onOpen: () => void;
}) {
  const { completedWeighted, gradeSoFar, currentMark } = useMemo(
    () => calcMetrics(course),
    [course]
  );
  const nd = useMemo(() => nextDue(course.assignments), [course.assignments]);

  return (
    <div
      className="group rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 shadow-sm hover:shadow-md transition cursor-pointer bg-white dark:bg-neutral-950"
      onClick={onOpen}
    >
      <div className="flex items-start gap-4">
        <Donut value={completedWeighted} celebrate={true} confetti={false} />
        <div className="flex-1">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold">{course.name}</h3>
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge intent="success">
              Completed: {completedWeighted.toFixed(1)}%
            </Badge>
            <Badge intent="info">
              Grade So Far:{" "}
              {gradeSoFar == null ? "—" : gradeSoFar.toFixed(1) + "%"}
            </Badge>
            <Badge>Current Mark: {currentMark.toFixed(1)}%</Badge>
          </div>
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <CalendarDays className="h-4 w-4" />
            {nd ? (
              <span>
                Next due:{" "}
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  {nd.title}
                </span>{" "}
                on {nd.dueDate}
              </span>
            ) : (
              <span>No upcoming deadlines</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CourseGrid({
  onOpenCourse,
  onAddCourse,
}: {
  onOpenCourse: (id: string) => void;
  onAddCourse?: () => void;
}) {
  const courses = useCourseStore((s) => s.courses);
  return (
    <div className="mx-auto max-w-6xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {courses.length === 0 ? (
        <div className="col-span-full rounded-2xl border border-dashed p-10 text-center text-neutral-500 dark:border-neutral-800">
          <div>Add your first course to get started.</div>
          {onAddCourse && (
            <div className="mt-4">
              <Button onClick={onAddCourse}>
                <Plus className="h-4 w-4" /> Add Course
              </Button>
            </div>
          )}
        </div>
      ) : (
        courses.map((c) => (
          <CourseCard key={c.id} course={c} onOpen={() => onOpenCourse(c.id)} />
        ))
      )}
    </div>
  );
}

function AddCourseModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const addCourse = useCourseStore((s) => s.addCourse);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setErr("Course name is required");
      return;
    }
    addCourse(trimmed);
    setName("");
    setErr("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Course">
      <form noValidate className="space-y-4" onSubmit={onSubmit}>
        <div>
          <label className="mb-1 block text-sm font-medium">Course name</label>
          <Input
            type="text"
            placeholder="e.g., CIV 312"
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (err) setErr("");
            }}
          />
          {err && <p className="mt-1 text-xs text-rose-600">{err}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit">Add</Button>
        </div>
      </form>
    </Modal>
  );
}

function AddAssignmentModal({
  open,
  onClose,
  courseId,
  defaultValues,
}: {
  open: boolean;
  onClose: () => void;
  courseId: string;
  defaultValues?: Partial<Assignment>;
}) {
  const addAssignment = useCourseStore((s) => s.addAssignment);

  const [title, setTitle] = useState(defaultValues?.title ?? "");
  const [dueDate, setDueDate] = useState<string>(defaultValues?.dueDate ?? "");
  const [weight, setWeight] = useState<string>(
    defaultValues?.weight !== undefined && defaultValues?.weight !== null
      ? String(defaultValues.weight)
      : ""
  );
  const [status, setStatus] = useState<AssignmentStatus>(
    defaultValues?.status ?? "not_started"
  );
  const [grade, setGrade] = useState<string>(
    defaultValues?.grade !== undefined && defaultValues?.grade !== null
      ? String(defaultValues.grade)
      : ""
  );
  const [errs, setErrs] = useState<{
    title?: string;
    weight?: string;
    grade?: string;
  }>({});

  const validate = () => {
    const e: { title?: string; weight?: string; grade?: string } = {};
    if (!title.trim()) e.title = "Title is required";

    const w = weight === "" ? NaN : Number(weight);
    if (!isFinite(w)) e.weight = "Enter a number (%, or fraction 0–1)";
    else if (w < 0) e.weight = "Weight must be ≥ 0";
    else if (w > 1000) e.weight = "Weight too large";

    if (grade !== "") {
      const g = Number(grade);
      if (!isFinite(g) || g < 0 || g > 100)
        e.grade = "Grade must be 0–100 or empty";
    }

    setErrs(e);
    return e;
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const eobj = validate();
    if (Object.keys(eobj).length) return;

    addAssignment(courseId, {
      title: title.trim(),
      dueDate: dueDate ? dueDate : null,
      weight: Number(weight),
      status,
      grade: grade === "" ? null : Number(grade),
    });

    // reset
    setTitle("");
    setDueDate("");
    setWeight("");
    setStatus("not_started");
    setGrade("");
    setErrs({});
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Assignment">
      <form noValidate className="space-y-4" onSubmit={onSubmit}>
        <div>
          <label className="mb-1 block text-sm font-medium">Title</label>
          <Input
            type="text"
            placeholder="e.g., Midterm"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (errs.title) setErrs({ ...errs, title: undefined });
            }}
          />
          {errs.title && (
            <p className="mt-1 text-xs text-rose-600">{errs.title}</p>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Due date</label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Weight</label>
            <Input
              type="number"
              step="any"
              placeholder="e.g., 25 or 0.25"
              value={weight}
              onChange={(e) => {
                const v = stripLeadingZerosInput(e.target.value);
                setWeight(v);
                if (errs.weight) setErrs({ ...errs, weight: undefined });
              }}
            />
            <p className="mt-1 text-xs text-neutral-500">
              Accepts % (0–100) or fraction (0–1)
            </p>
            {errs.weight && (
              <p className="mt-1 text-xs text-rose-600">{errs.weight}</p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Status</label>
            <SelectBox
              value={status}
              onChange={(v) => setStatus(v as AssignmentStatus)}
            >
              <option value="not_started">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
              <option value="overdue">Overdue</option>
            </SelectBox>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Grade (%)</label>
            <Input
              type="number"
              step="any"
              placeholder="e.g., 87"
              value={grade}
              onChange={(e) => {
                setGrade(e.target.value);
                if (errs.grade) setErrs({ ...errs, grade: undefined });
              }}
            />
            <p className="mt-1 text-xs text-neutral-500">
              Leave empty if not graded yet
            </p>
            {errs.grade && (
              <p className="mt-1 text-xs text-rose-600">{errs.grade}</p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit">Add</Button>
        </div>
      </form>
    </Modal>
  );
}

function EditCourseName({ course }: { course: Course }) {
  const rename = useCourseStore((s) => s.renameCourse);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(course.name);
  useEffect(() => setName(course.name), [course.name]);

  return (
    <div className="flex items-center gap-2">
      {editing ? (
        <>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-auto"
          />
          <Button
            onClick={() => {
              if (name.trim().length) {
                rename(course.id, name.trim());
                setEditing(false);
              }
            }}
          >
            Save
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setName(course.name);
            }}
          >
            Cancel
          </Button>
        </>
      ) : (
        <>
          <h2 className="text-xl font-semibold">{course.name}</h2>
          <button
            className="rounded-lg p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            onClick={() => setEditing(true)}
            title="Rename course"
          >
            {/* pencil icon via CSS circle */}
            <span className="inline-block h-4 w-4 rounded-full bg-neutral-300" />
          </button>
        </>
      )}
    </div>
  );
}

function AssignmentRow({
  a,
  onChange,
  onRemove,
}: {
  a: Assignment;
  onChange: (patch: Partial<Assignment>) => void;
  onRemove: () => void;
}) {
  const overdueDerived = a.status !== "completed" && isPast(a.dueDate);

  useEffect(() => {
    if (overdueDerived && a.status !== "overdue")
      onChange({ status: "overdue" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.dueDate, a.status]);

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">
              {a.title || "Untitled"}
            </span>
            {a.status === "completed" && (
              <Badge intent="success">Completed</Badge>
            )}
            {a.status === "overdue" && <Badge intent="danger">Overdue</Badge>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 w-full">
        <Input
          value={a.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Title"
        />
        <Input
          type="date"
          value={a.dueDate ?? ""}
          onChange={(e) => onChange({ dueDate: e.target.value || null })}
        />
        <Input
          type="number"
          step="any"
          value={a.weight}
          onChange={(e) => {
            const v = stripLeadingZerosInput(e.target.value);
            onChange({ weight: v === "" ? 0 : Number(v) });
          }}
          placeholder="Weight"
        />
        <SelectBox
          value={a.status}
          onChange={(v) => onChange({ status: v as AssignmentStatus })}
        >
          <option value="not_started">Not started</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
          <option value="overdue">Overdue</option>
        </SelectBox>
        <Input
          type="number"
          step="any"
          value={a.grade ?? ""}
          onChange={(e) =>
            onChange({
              grade: e.target.value === "" ? null : Number(e.target.value),
            })
          }
          placeholder="Grade %"
        />
      </div>

      <div className="w-full mt-1 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
        <div className="flex items-center gap-1">
          <CalendarDays className="h-4 w-4" />
          {a.dueDate ?? "No date"}
        </div>
        <div>Weight: {normalizeWeightToPercent(a.weight).toFixed(2)}%</div>
        <div>Grade: {a.grade == null ? "—" : `${a.grade}%`}</div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={() => onChange({ status: "completed" })}
        >
          <CheckCircle2 className="h-4 w-4" /> Mark Completed
        </Button>
        <button
          className="rounded-xl p-2 border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          onClick={onRemove}
          title="Remove"
        >
          <Trash2 className="h-4 w-4 text-rose-600" />
        </button>
      </div>
    </div>
  );
}

function CourseDetail({
  courseId,
  onBack,
}: {
  courseId: string;
  onBack: () => void;
}) {
  const course = useCourseStore(
    (s) => s.courses.find((c) => c.id === courseId)!
  );
  const update = useCourseStore((s) => s.updateAssignment);
  const remove = useCourseStore((s) => s.removeAssignment);
  const removeCourse = useCourseStore((s) => s.removeCourse);
  const [addOpen, setAddOpen] = useState(false);

  const { completedWeighted, gradeSoFar, currentMark, totalWeights } = useMemo(
    () => calcMetrics(course),
    [course]
  );

  return (
    <div className="mx-auto max-w-6xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <EditCourseName course={course} />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Add Assignment
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              if (confirm("Delete this course?")) {
                removeCourse(course.id);
                onBack();
              }
            }}
          >
            <Trash2 className="h-4 w-4 text-rose-600" /> Delete Course
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 bg-white dark:bg-neutral-950">
          <div className="flex items-center gap-2 mb-2">
            <Gauge className="h-4 w-4" />
            <span className="font-semibold">Completed (weighted)</span>
          </div>
          <div className="flex items-center gap-4">
            <Donut value={completedWeighted} celebrate={true} />
            <div>
              <div className="text-3xl font-semibold">
                {completedWeighted.toFixed(1)}%
              </div>
              <div className="text-xs text-neutral-500">
                Total weights: {totalWeights.toFixed(1)}%
              </div>
              {Math.abs(totalWeights - 100) > 0.01 && (
                <div className="mt-1 inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-900/30 rounded-md px-2 py-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> Weights do not sum
                  to 100%
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 bg-white dark:bg-neutral-950">
          <div className="flex items-center gap-2 mb-2">
            <Info className="h-4 w-4" />
            <span className="font-semibold">Grade So Far</span>
          </div>
          <div className="text-3xl font-semibold">
            {gradeSoFar == null ? "—" : gradeSoFar.toFixed(1) + "%"}
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            Average over completed work only.
          </p>
        </div>
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 bg-white dark:bg-neutral-950">
          <div className="flex items-center gap-2 mb-2">
            <Info className="h-4 w-4" />
            <span className="font-semibold">Current Mark</span>
          </div>
          <div className="text-3xl font-semibold">
            {currentMark.toFixed(1)}%
          </div>
          <p className="mt-1 text-sm text-neutral-500">Counts missing as 0.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 bg-white dark:bg-neutral-950">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            <span className="font-semibold">Assignments</span>
          </div>
          <Button variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Add Assignment
          </Button>
        </div>
        <div className="space-y-3">
          {course.assignments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-8 text-center text-neutral-500">
              No assignments yet.
            </div>
          ) : (
            course.assignments
              .slice()
              .sort((a, b) =>
                (a.dueDate ?? "9999-12-31").localeCompare(
                  b.dueDate ?? "9999-12-31"
                )
              )
              .map((a) => (
                <AssignmentRow
                  key={a.id}
                  a={a}
                  onChange={(patch) => update(course.id, a.id, patch)}
                  onRemove={() => remove(course.id, a.id)}
                />
              ))
          )}
        </div>
      </div>

      <AddAssignmentModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        courseId={course.id}
      />
    </div>
  );
}

// ==========================
// Export / Import JSON (optional)
// ==========================
function ExportImportBar() {
  const courses = useCourseStore((s) => s.courses);
  const setCourses = useCourseStore.setState;

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ courses }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "courses_export.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result));
        if (obj && Array.isArray(obj.courses)) {
          setCourses({ courses: obj.courses });
          alert("Imported successfully.");
        } else {
          alert("Invalid file format.");
        }
      } catch (e) {
        alert("Could not parse JSON.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pb-2 flex items-center gap-2 text-sm">
      <Button variant="outline" onClick={exportJson}>
        Export JSON
      </Button>
      <label className="inline-flex items-center gap-2 rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-2 cursor-pointer">
        <input
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importJson(f);
          }}
        />
        Import JSON
      </label>
    </div>
  );
}

// ==========================
// Welcome Page (bubbly + cute)
// ==========================
function WelcomeHome({
  onAddCourse,
  onSkip,
}: {
  onAddCourse: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="relative mx-auto max-w-6xl px-4 py-12">
      {/* floating cute shapes */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-8 -left-8 h-40 w-40 rounded-full bg-pink-200/60 blur-2xl" />
        <div className="absolute top-16 -right-10 h-44 w-44 rounded-full bg-rose-100/70 blur-2xl" />
        <div className="absolute bottom-0 left-10 h-36 w-36 rounded-full bg-sky-200/60 blur-2xl" />
        <div className="absolute bottom-10 right-24 h-28 w-28 rounded-full bg-emerald-200/60 blur-2xl" />
      </div>

      <div className="rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-8 shadow-sm">
        <div className="flex flex-col lg:flex-row items-center gap-8">
          <div className="flex-1">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Welcome to{" "}
              <span className="bg-gradient-to-r from-pink-500 via-rose-400 to-emerald-500 bg-clip-text text-transparent">
                MarkMate
              </span>
            </h1>
            <p className="mt-3 text-neutral-600 dark:text-neutral-300 max-w-prose">
              Your cute, colorful space to plan assignments, track progress, and
              celebrate wins. Add your courses, check off tasks, and watch your
              progress ring glow — with a little confetti when you hit 100%.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button onClick={onAddCourse}>
                <Plus className="h-4 w-4" /> Add your first course
              </Button>
              <Button variant="outline" onClick={onSkip}>
                Skip to dashboard
              </Button>
            </div>
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 bg-neutral-50 dark:bg-neutral-900/60">
                <div className="font-semibold">Plan</div>
                <p className="mt-1 text-neutral-600 dark:text-neutral-300">
                  Add assignments with due dates and weights.
                </p>
              </div>
              <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 bg-neutral-50 dark:bg-neutral-900/60">
                <div className="font-semibold">Track</div>
                <p className="mt-1 text-neutral-600 dark:text-neutral-300">
                  See <em>Grade So Far</em> and your <em>Current Mark</em>.
                </p>
              </div>
              <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 bg-neutral-50 dark:bg-neutral-900/60">
                <div className="font-semibold">Celebrate</div>
                <p className="mt-1 text-neutral-600 dark:text-neutral-300">
                  Hit 100% and enjoy a cheerful confetti moment.
                </p>
              </div>
            </div>
          </div>
          <div className="flex-1 w-full max-w-md">
            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-6 bg-gradient-to-br from-pink-50 via-rose-50 to-emerald-50 dark:from-neutral-900 dark:via-neutral-900 dark:to-neutral-900">
              <div className="flex items-center gap-4">
                <div className="shrink-0">
                  {/* decorative sample ring */}
                  <div className="h-24 w-24">
                    <div className="h-full w-full rounded-full border-8 border-emerald-400 relative">
                      <div className="absolute inset-0 rounded-full border-8 border-rose-300/30" />
                    </div>
                  </div>
                </div>
                <div className="flex-1">
                  <div className="text-lg font-semibold">
                    Your progress ring
                  </div>
                  <p className="text-sm text-neutral-600 dark:text-neutral-300">
                    It changes color as you level up. Green means you’re nearly
                    there!
                  </p>
                </div>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 p-3">
                  <div className="text-xs text-neutral-500">Current Mark</div>
                  <div className="text-xl font-semibold">—%</div>
                </div>
                <div className="rounded-xl bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 p-3">
                  <div className="text-xs text-neutral-500">Grade So Far</div>
                  <div className="text-xl font-semibold">—%</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================
// Main App
// ==========================
export default function App() {
  const [addOpen, setAddOpen] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(true);
  const courses = useCourseStore((s) => s.courses);

  useEffect(() => {
    if (courses.length > 0) setShowWelcome(false);
  }, [courses.length]);

  const allCompleted = useMemo(
    () =>
      courses.length > 0 &&
      courses.every((c) => calcMetrics(c).completedWeighted >= 100),
    [courses]
  );
  const homeFired = React.useRef(false);
  useEffect(() => {
    if (
      !selectedCourseId &&
      !showWelcome &&
      allCompleted &&
      !homeFired.current
    ) {
      homeFired.current = true;
      (async () => {
        try {
          const { default: JSConfetti } = await import("js-confetti");
          const jsConfetti = new JSConfetti();
          await jsConfetti.addConfetti({
            emojis: ["🎈", "🎉", "✨", "🎊"],
            emojiSize: 40,
            confettiNumber: 200,
          });
          await jsConfetti.addConfetti({
            confettiRadius: 5,
            confettiNumber: 500,
          });
        } catch (e) {
          const { default: confetti } = await import("canvas-confetti");
          confetti({ particleCount: 300, spread: 120 });
          confetti({
            particleCount: 300,
            spread: 120,
            angle: 60,
            origin: { x: 0 },
          });
          confetti({
            particleCount: 300,
            spread: 120,
            angle: 120,
            origin: { x: 1 },
          });
        }
      })();
    }
    if (selectedCourseId || !allCompleted) {
      homeFired.current = false;
    }
  }, [selectedCourseId, allCompleted, showWelcome]);

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <TopBar
        onAddCourse={() => setAddOpen(true)}
        onHome={() => {
          setSelectedCourseId(null);
          setShowWelcome(true);
        }}
      />
      <ExportImportBar />

      {selectedCourseId ? (
        <CourseDetail
          courseId={selectedCourseId}
          onBack={() => setSelectedCourseId(null)}
        />
      ) : showWelcome ? (
        <WelcomeHome
          onAddCourse={() => setAddOpen(true)}
          onSkip={() => setShowWelcome(false)}
        />
      ) : (
        <CourseGrid
          onOpenCourse={(id) => setSelectedCourseId(id)}
          onAddCourse={() => setAddOpen(true)}
        />
      )}

      <AddCourseModal open={addOpen} onClose={() => setAddOpen(false)} />

      <footer className="mt-16 border-t border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto max-w-6xl p-4 text-xs text-neutral-500">
          Tip: <strong>Grade So Far</strong> is the average on what’s marked.{" "}
          <strong>Current Mark</strong> is your overall now if everything
          missing were zero.
        </div>
      </footer>
    </div>
  );
}
