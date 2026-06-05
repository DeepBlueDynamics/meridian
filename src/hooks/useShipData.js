import { useContext } from "react";
import { ShipDataContext } from "../context/ShipDataContext.jsx";

export const useShipData = () => {
  const ctx = useContext(ShipDataContext);
  if (!ctx) throw new Error("useShipData must be used within ShipDataProvider");
  return ctx.data;
};

export const useShipDataSetter = () => {
  const ctx = useContext(ShipDataContext);
  if (!ctx) throw new Error("useShipDataSetter must be used within ShipDataProvider");
  return ctx.setData;
};
