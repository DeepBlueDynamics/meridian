const WidgetFrame = ({ title, children, color = "#22c55e" }) => {
  return (
    <div
      style={{
        background: "#0b0b0f",
        border: `1px solid ${color}55`,
        borderRadius: 10,
        padding: 14,
        boxShadow: `0 0 24px ${color}22`,
        width: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          color,
          fontSize: 12,
          letterSpacing: 1,
          marginBottom: 8,
          textTransform: "uppercase",
        }}
      >
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
};

export default WidgetFrame;
