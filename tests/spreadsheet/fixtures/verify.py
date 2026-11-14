"""Verify LopeOS's exported package with an independent XLSX reader."""
import json
import platform
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
import openpyxl
from openpyxl import load_workbook

root = Path(__file__).resolve().parents[3]
path = Path(__file__).parent / 'roundtrip-budget.xlsx'
workbook = load_workbook(path)
sheet = workbook['Budget 2026']
checks = {
    'number_value': sheet['B2'].value == 1200,
    'formula_text': sheet['B6'].value == '=SUM(B2:B4)',
    'cross_sheet_formula': workbook['Summary']['A1'].value == "='Budget 2026'!B6",
    'custom_number_format': sheet['B2'].number_format == '#,##0.00;[Red](#,##0.00)',
    'font_bold': sheet['B2'].font.bold is True,
    'fill_rgb': sheet['B2'].fill.fgColor.rgb == 'FFE5F3E8',
    'border': sheet['B2'].border.bottom.style == 'double',
    'note_text': sheet['C2'].comment.text == 'Reviewed estimate',
    'hyperlink': sheet['F4'].hyperlink.target.startswith('https://learn.microsoft.com/'),
    'merge': 'A8:D8' in sheet.merged_cells,
    'table_reference': sheet.tables['BudgetData'].ref == 'A1:D4',
    'validation_range': any(str(rule.sqref) == 'B2:C4' for rule in sheet.data_validations.dataValidation),
    'validation_list': any(rule.formula1 == '"Draft,Reviewed,Approved"' for rule in sheet.data_validations.dataValidation),
    'conditional_rule': len(sheet.conditional_formatting) == 1,
    'named_range': workbook.defined_names['TaxRate'].attr_text == "'Budget 2026'!$G$1",
    'freeze_panes': sheet.freeze_panes == 'B2',
    'print_area': str(sheet.print_area) == "'Budget 2026'!$A$1:$G$8",
    'repeat_rows': sheet.print_title_rows == '$1:$1',
    'paper': str(sheet.page_setup.paperSize) == '9',
    'orientation': sheet.page_setup.orientation == 'landscape',
    'hidden_sheet': workbook['Summary'].sheet_state == 'hidden',
    'manual_calculation': workbook.calculation.calcMode == 'manual',
}
cached = load_workbook(path, data_only=True)
checks['cached_formula_result'] = cached['Budget 2026']['B6'].value == 6300
checks['cached_zero'] = cached['Budget 2026']['H1'].value == 0
with zipfile.ZipFile(path) as archive:
    xml = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
    namespaces = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    checks['1900_serial_60_raw'] = xml.find('.//x:c[@r="G2"]/x:v', namespaces).text == '60'
report = {'reader': f'openpyxl {openpyxl.__version__}', 'python': sys.version.split()[0], 'platform': platform.platform(), 'fixture': str(path.relative_to(root)), 'excel_installation_tested': False, 'checks': checks, 'passed': sum(checks.values()), 'total': len(checks)}
(root / 'docs/spreadsheet/independent-xlsx-results.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
assert all(checks.values()), [name for name, passed in checks.items() if not passed]
