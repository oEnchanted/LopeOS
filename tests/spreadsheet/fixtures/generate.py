"""Independent fixture generator. Requires openpyxl==3.1.5; no Excel installation claims."""
from pathlib import Path
from datetime import datetime
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.comments import Comment
from openpyxl.chart import BarChart, Reference
from openpyxl.formatting.rule import CellIsRule
from openpyxl.utils.datetime import CALENDAR_MAC_1904

OUT = Path(__file__).parent
wb = Workbook()
ws = wb.active
ws.title = 'Budget 2026'
for row in [['Department','Plan','Actual','Variance'],['Design',1200,1100,'=B2-C2'],['Engineering',3400,3650,'=B3-C3'],['Operations',1700,1580,'=B4-C4']]:
    ws.append(row)
ws['A6'] = 'Total'
ws['B6'] = '=SUM(B2:B4)'
ws['C6'] = '=SUM(C2:C4)'
ws['D6'] = '=B6-C6'
ws['F1'] = 'Tax rate'
ws['G1'] = 0.07
ws['G1'].number_format = '0.00%'
ws['F2'] = '1900 leap-day serial'
ws['G2'] = 60
ws['G2'].number_format = 'yyyy-mm-dd'
ws['A8'] = 'Notes: original source produced by openpyxl 3.1.5'
ws.merge_cells('A8:D8')
ws['B2'].number_format = '#,##0.00;[Red](#,##0.00)'
ws['B2'].font = Font(name='Aptos', size=11, bold=True, color='FF1B6B42')
ws['B2'].fill = PatternFill('solid', fgColor='FFE5F3E8')
ws['B2'].border = Border(bottom=Side(style='double', color='FF1B6B42'))
ws['B2'].alignment = Alignment(horizontal='right', wrap_text=True)
ws['C2'].comment = Comment('Reviewed estimate', 'Fixture author')
ws['F4'] = 'Documentation'
ws['F4'].hyperlink = 'https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document'
ws.column_dimensions['A'].width = 22
ws.row_dimensions[1].height = 24
ws.freeze_panes = 'B2'
ws.sheet_properties.tabColor = '16833F'
ws.print_options.gridLines = True
ws.print_options.headings = True
ws.print_area = 'A1:G8'
ws.print_title_rows = '1:1'
ws.page_setup.orientation = 'landscape'
ws.page_setup.paperSize = ws.PAPERSIZE_A4
ws.oddFooter.center.text = 'Page &P of &N'
validation = DataValidation(type='whole', operator='between', formula1=0, formula2=100000, allow_blank=True)
validation.errorTitle = 'Budget range'; validation.error = 'Enter 0–100000.'; validation.showErrorMessage = True
ws.add_data_validation(validation); validation.add('B2:C4')
list_validation = DataValidation(type='list', formula1='"Draft,Reviewed,Approved"')
ws.add_data_validation(list_validation); list_validation.add('F6')
ws['F6'] = 'Draft'
ws.conditional_formatting.add('D2:D4', CellIsRule(operator='lessThan', formula=['0'], fill=PatternFill('solid', fgColor='FFFFC7CE')))
ws.add_table(Table(displayName='BudgetData', ref='A1:D4', tableStyleInfo=TableStyleInfo(name='TableStyleMedium2', showRowStripes=True)))
wb.defined_names.add(DefinedName('TaxRate', attr_text="'Budget 2026'!$G$1"))
other = wb.create_sheet('Summary')
other['A1'] = "='Budget 2026'!B6"
other['A2'] = '=TaxRate'
other.sheet_state = 'hidden'
wb.save(OUT / 'independent-budget.xlsx')
chart = BarChart(); chart.title = 'Plan and actual'; chart.add_data(Reference(ws, min_col=2, max_col=3, min_row=1, max_row=4), titles_from_data=True); chart.set_categories(Reference(ws, min_col=1, min_row=2, max_row=4)); ws.add_chart(chart, 'I2')
wb.save(OUT / 'independent-budget-chart.xlsx')
old = Workbook(); old.epoch = CALENDAR_MAC_1904; old.active['A1'] = 0; old.active['A1'].number_format = 'yyyy-mm-dd'; old.active['A2'] = 60; old.active['A2'].number_format = 'yyyy-mm-dd'; old.save(OUT / 'independent-1904.xlsx')
edge = Workbook(); edge.active['A1'] = 'Start'; edge.active['XFD1048576'] = 'End'; edge.save(OUT / 'independent-boundaries.xlsx')
print('Generated four independent XLSX fixtures with openpyxl 3.1.5.')
