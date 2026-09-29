import { useRef, useState } from "react";
import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

const SORT_ICON = { asc: " ▲", desc: " ▼" };

// A row-virtualized table for large, unpaginated datasets (the Fuel &
// Invoice grid can have thousands of rows with no "page 1 of N" — per her
// explicit request) — only the rows actually scrolled into view are ever
// mounted, so the DOM/React cost stays roughly constant regardless of the
// real row count instead of growing with it (which is what made the plain,
// render-everything DataTable hang once this grid had ~2000 rows).
export default function VirtualizedGrid({ columns, data, emptyMessage, rowHeight = 44, maxHeight = "65vh" }) {
  const [sorting, setSorting] = useState([]);
  const parentRef = useRef(null);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const headerGroups = table.getHeaderGroups();

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualRows.length ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length ? totalSize - virtualRows[virtualRows.length - 1].end : 0;

  return (
    <div className="table-wrap" ref={parentRef} style={{ maxHeight, overflow: "auto" }}>
      <table>
        <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
          {headerGroups.map((hg, hgIndex) => (
            <tr key={hg.id} className={headerGroups.length > 1 && hgIndex === 0 ? "group-row" : ""}>
              {hg.headers.map(h => (
                <th
                  key={h.id}
                  onClick={h.column.getCanSort() ? h.column.getToggleSortingHandler() : undefined}
                  className={[
                    h.column.getCanSort() ? "sortable-col" : "",
                    h.column.columnDef.meta?.align === "end" ? "col-end" : "",
                    h.column.columnDef.meta?.align === "center" ? "col-center" : "",
                    h.column.columnDef.meta?.narrow ? "col-narrow" : "",
                  ].filter(Boolean).join(" ")}
                >
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  {SORT_ICON[h.column.getIsSorted()] || ""}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {!rows.length ? (
            <tr className="empty-row"><td colSpan={table.getAllLeafColumns().length}>{emptyMessage}</td></tr>
          ) : (
            <>
              {paddingTop > 0 && <tr style={{ height: paddingTop }} aria-hidden="true"><td colSpan={table.getAllLeafColumns().length} /></tr>}
              {virtualRows.map(vRow => {
                const row = rows[vRow.index];
                return (
                  <tr key={row.id} data-index={vRow.index} style={{ height: rowHeight }}>
                    {row.getVisibleCells().map(cell => (
                      <td
                        key={cell.id}
                        className={[
                          cell.column.columnDef.meta?.align === "end" ? "col-end" : "",
                          cell.column.columnDef.meta?.align === "center" ? "col-center" : "",
                          cell.column.columnDef.meta?.narrow ? "col-narrow" : "",
                        ].filter(Boolean).join(" ")}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {paddingBottom > 0 && <tr style={{ height: paddingBottom }} aria-hidden="true"><td colSpan={table.getAllLeafColumns().length} /></tr>}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
