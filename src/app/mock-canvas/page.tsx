import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Mock Canvas dashboard for testing the Tiruno Companion extension.",
};

type Course = {
  id: number;
  name: string;
  code: string;
  term: string;
  color: string;
};

// Realistic course list. The Tiruno extension scrapes the `.ic-DashboardCard__header-title`
// text and `a[href*="/courses/"]` links from this page.
const COURSES: Course[] = [
  { id: 101, name: "Introduction to Psychology", code: "PSY-101", term: "Fall 2026", color: "#0374B5" },
  { id: 214, name: "Calculus II", code: "MATH-214", term: "Fall 2026", color: "#BF32A4" },
  { id: 330, name: "Organic Chemistry", code: "CHEM-330", term: "Fall 2026", color: "#E62429" },
  { id: 158, name: "World History: 1500 to Present", code: "HIST-158", term: "Fall 2026", color: "#0B874B" },
  { id: 110, name: "Introduction to Computer Science", code: "CS-110", term: "Fall 2026", color: "#F06291" },
  { id: 205, name: "Microeconomic Principles", code: "ECON-205", term: "Fall 2026", color: "#8B5CF6" },
];

const GLOBAL_NAV = ["Account", "Dashboard", "Courses", "Calendar", "Inbox", "History", "Help"];

export default function MockCanvasDashboard() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        background: "#f5f5f5",
        color: "#2d3b45",
        fontFamily:
          'Lato, "Helvetica Neue", Helvetica, Arial, sans-serif',
        overflow: "auto",
      }}
    >
      {/* Global left nav (Canvas style) */}
      <nav
        style={{
          width: 84,
          minWidth: 84,
          background: "#394B58",
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: 12,
          gap: 4,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 8,
            background: "#E62429",
            display: "grid",
            placeItems: "center",
            fontWeight: 800,
            fontSize: 22,
            marginBottom: 12,
          }}
          aria-label="Canvas"
        >
          C
        </div>
        {GLOBAL_NAV.map((item) => (
          <div
            key={item}
            style={{
              fontSize: 11,
              textAlign: "center",
              padding: "10px 4px",
              width: "100%",
              opacity: item === "Dashboard" ? 1 : 0.85,
              background: item === "Dashboard" ? "#2d3b45" : "transparent",
            }}
          >
            {item}
          </div>
        ))}
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, padding: "24px 32px", maxWidth: 1180 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 24,
          }}
        >
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Dashboard</h1>
          <button
            style={{
              border: "1px solid #c7cdd1",
              background: "#fff",
              borderRadius: 4,
              padding: "8px 14px",
              fontSize: 14,
              color: "#2d3b45",
            }}
          >
            View Grades
          </button>
        </header>

        <section
          className="ic-DashboardCard__box"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(262px, 1fr))",
            gap: 18,
          }}
        >
          {COURSES.map((course) => (
            <div
              key={course.id}
              className="ic-DashboardCard"
              style={{
                background: "#fff",
                border: "1px solid #c7cdd1",
                borderRadius: 6,
                overflow: "hidden",
                boxShadow: "0 1px 1px rgba(0,0,0,0.1)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <a
                className="ic-DashboardCard__link"
                href={`/courses/${course.id}`}
                title={course.name}
                aria-label={course.name}
                style={{ textDecoration: "none", color: "inherit", display: "block" }}
              >
                <div
                  className="ic-DashboardCard__header_image"
                  style={{ height: 146, background: course.color }}
                />
                <div className="ic-DashboardCard__header_content" style={{ padding: "10px 12px" }}>
                  <h3
                    className="ic-DashboardCard__header-title"
                    style={{ margin: 0, fontSize: 16, fontWeight: 700, color: course.color }}
                  >
                    <span title={course.name}>{course.name}</span>
                  </h3>
                  <div
                    className="ic-DashboardCard__header-subtitle"
                    style={{ fontSize: 13, color: "#6b7780", marginTop: 4 }}
                  >
                    {course.code}
                  </div>
                  <div
                    className="ic-DashboardCard__header-term"
                    style={{ fontSize: 12, color: "#6b7780", marginTop: 2 }}
                  >
                    {course.term}
                  </div>
                </div>
              </a>
              <div
                className="ic-DashboardCard__action-container"
                style={{
                  display: "flex",
                  gap: 18,
                  padding: "8px 12px",
                  borderTop: "1px solid #eee",
                  color: "#6b7780",
                  fontSize: 13,
                }}
              >
                <span>Announcements</span>
                <span>Assignments</span>
                <span>Discussions</span>
                <span>Files</span>
              </div>
            </div>
          ))}
        </section>

        <p style={{ marginTop: 28, fontSize: 12, color: "#9aa5ab" }}>
          Mock Canvas dashboard — for testing the Tiruno Companion extension only.
        </p>
      </main>
    </div>
  );
}
