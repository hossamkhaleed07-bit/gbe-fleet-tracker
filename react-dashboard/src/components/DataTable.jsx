import { useState } from "react";
import { useReactTable, getCoreRowModel, getSortedRowModel, getPaginationRowModel, flexRender } from "@tanstack/react-table";
import { useLang } from "../contexts/LanguageContext";

const SORT_ICON = { asc: " ▲", desc: " ▼" };

// Shared table shell: sorting + client-side pagination + optional row click,
// rendered with the app's existing .table-wrap/table CSS (no new styling
// system). Pages keep owning their own search/filter state and just pass the
// already-filtered rows in — this only adds sort/paginate/row-click on top.
export default function DataTable({ columns, data, onRowClick, emptyMessage, pageSize = 20 }) {
  const { t } = useLang();
  const [sorting, setSorting] = useState([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize });

  const table = useReactTable({
    data,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const rows = table.getRowModel().rows;
  const headerGroups = table.getHeaderGroups();

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
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
                      h.column.columnDef.meta?.groupAlt ? "group-alt" : "",
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
            ) : rows.map(row => (
              <tr
                key={row.id}
                className={onRowClick ? "clickable-row" : ""}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              >
                {row.getVisibleCells().map(cell => (
                  <td
                    key={cell.id}
                    className={[
                      cell.column.columnDef.meta?.align === "end" ? "col-end" : "",
                      cell.column.columnDef.meta?.align === "center" ? "col-center" : "",
                      cell.column.columnDef.meta?.groupAlt ? "group-alt" : "",
                      cell.column.columnDef.meta?.narrow ? "col-narrow" : "",
                    ].filter(Boolean).join(" ")}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.getPageCount() > 1 && (
        <div className="table-pagination">
          <button className="btn" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>‹ {t("common.prevPage")}</button>
          <span>{t("common.pageOfTotal", { page: pagination.pageIndex + 1, total: table.getPageCount() })}</span>
          <button className="btn" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>{t("common.nextPage")} ›</button>
        </div>
      )}
    </>
  );
}
