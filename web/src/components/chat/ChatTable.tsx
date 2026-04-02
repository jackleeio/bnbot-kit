import React from 'react';
import { TableData } from '@/types/chat';
import { formatChatContent } from '@/utils/chatFormatters';

interface ChatTableProps {
  tableData: TableData;
}

const ChatTable: React.FC<ChatTableProps> = ({ tableData }) => {
  console.log(
    'Rendering ChatTable with data:',
    JSON.stringify(tableData, null, 2),
  );

  if (!tableData || !tableData.headers || !tableData.rows) {
    console.log('Invalid table data received');
    return null;
  }

  // Check if this is a 2-column key-value table (like Bitcoin price details)
  // Only treat as key-value if headers explicitly indicate it (e.g., "项目 | 数据")
  const isKeyValueTable =
    tableData.headers.length === 2 &&
    ((tableData.headers[0] === '项目' && tableData.headers[1] === '数据') ||
      (tableData.headers[0] === 'Property' &&
        tableData.headers[1] === 'Value') ||
      (tableData.headers[0] === 'Key' && tableData.headers[1] === 'Value'));

  if (isKeyValueTable) {
    // Render as key-value pairs without headers
    return (
      <div className="mx-auto my-4 max-w-2xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="divide-y divide-gray-200">
          {tableData.rows.map((row, rowIndex) => (
            <div key={rowIndex} className="flex hover:bg-gray-50">
              <div className="flex-1 bg-gray-50/50 px-3 py-2 text-xs font-medium text-gray-700">
                <div
                  className="break-words"
                  dangerouslySetInnerHTML={{
                    __html: formatChatContent(row[0]?.trim() || ''),
                  }}
                />
              </div>
              <div className="flex-1 px-3 py-2 text-xs text-gray-900">
                <div
                  className="break-words"
                  dangerouslySetInnerHTML={{
                    __html: formatChatContent(row[1]?.trim() || ''),
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Render as standard table with headers
  return (
    <div className="mx-auto my-4 max-w-3xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {tableData.headers.map((header, index) => (
                <th
                  key={index}
                  className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                >
                  <span
                    dangerouslySetInnerHTML={{
                      __html: formatChatContent(header.trim()),
                    }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {tableData.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-gray-50">
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className="px-3 py-2 text-left text-xs text-gray-700"
                  >
                    <div
                      className="break-words"
                      dangerouslySetInnerHTML={{
                        __html: formatChatContent(cell?.trim() || ''),
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ChatTable;
