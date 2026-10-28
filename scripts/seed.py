"""Generate fictional orders and register a real, embedded Superset dashboard."""
import json
import random
import sqlite3
import uuid
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCAL = ROOT / '.local'
secrets = json.loads((LOCAL / 'secrets.json').read_text())
rng = random.Random(44)
connection = sqlite3.connect(LOCAL / 'retail.db')
connection.execute('CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, client_id TEXT, order_date TEXT, product TEXT, category TEXT, channel TEXT, region TEXT, revenue REAL, cost REAL, quantity INTEGER, customer_id TEXT)')
connection.execute('DELETE FROM orders')
products = {
    'atelier': [('Arc lounge chair', 'Furniture', 340), ('Forma side table', 'Furniture', 180), ('Linen cushion', 'Textiles', 48), ('Studio ceramic vase', 'Decor', 65), ('Oak desk lamp', 'Lighting', 120), ('Woven throw', 'Textiles', 85)],
    'coast': [('Trail daypack', 'Bags', 110), ('Coastal shell jacket', 'Clothing', 165), ('Insulated flask', 'Accessories', 38), ('Summit hiking boots', 'Footwear', 190), ('Canvas weekend bag', 'Bags', 145), ('Merino trail socks', 'Clothing', 24)]
}
rows = []
start = date(2026, 7, 1)
for tenant, catalog in products.items():
    for day in range(120):
        for _ in range(rng.randint(12, 25) if tenant == 'atelier' else rng.randint(8, 18)):
            name, category, price = rng.choice(catalog)
            quantity = rng.choices([1, 2, 3], [0.7, 0.23, 0.07])[0]
            revenue = round(price * quantity * rng.uniform(.9, 1.12), 2)
            rows.append((tenant, (start + timedelta(days=day)).isoformat() + ' 12:00:00', name, category, rng.choices(['Online store', 'Retail', 'Wholesale'], [0.62, 0.27, 0.11])[0], rng.choice(['Greater Accra', 'Ashanti', 'Western', 'Central']), revenue, round(revenue * rng.uniform(.42, .68), 2), quantity, f'{tenant}-{rng.randint(1, 550)}'))
connection.executemany('INSERT INTO orders(client_id, order_date, product, category, channel, region, revenue, cost, quantity, customer_id) VALUES (?,?,?,?,?,?,?,?,?,?)', rows)
connection.commit()
connection.close()

from superset.app import create_app
app = create_app()
from superset import db, security_manager
from superset.models.core import Database
from superset.connectors.sqla.models import SqlaTable
from superset.models.slice import Slice
from superset.models.dashboard import Dashboard
from superset.models.embedded_dashboard import EmbeddedDashboard

with app.app_context():
    admin_role = security_manager.find_role('Admin')
    if not security_manager.find_user(username='admin'):
        security_manager.add_user('admin', 'Local', 'Admin', 'admin@example.test', admin_role, secrets['adminPassword'])
    guest_role = security_manager.add_role('EmbeddedGuest')
    gamma = security_manager.find_role('Gamma')
    guest_role.permissions = [permission for permission in gamma.permissions if permission.permission.name not in {'can_write', 'can_delete', 'can_delete_embedded', 'can_tag', 'can_cache_dashboard_screenshot'}]
    service_role = security_manager.add_role('PortalTokenService')
    grant = security_manager.find_permission_view_menu('can_grant_guest_token', 'SecurityRestApi')
    if not grant:
        grant = security_manager.add_permission_view_menu('can_grant_guest_token', 'SecurityRestApi')
    csrf_read = security_manager.find_permission_view_menu('can_read', 'SecurityRestApi')
    service_role.permissions = [grant, csrf_read]
    if not security_manager.find_user(username='portal-service'):
        security_manager.add_user('portal-service', 'Portal', 'Service', 'portal@example.test', service_role, secrets['servicePassword'])
    database = db.session.query(Database).filter_by(database_name='Folio sample data').first()
    if not database:
        database = Database(database_name='Folio sample data', sqlalchemy_uri=f"sqlite:///{LOCAL / 'retail.db'}", expose_in_sqllab=False)
        db.session.add(database)
        db.session.flush()
    dataset = db.session.query(SqlaTable).filter_by(table_name='orders', database_id=database.id).first()
    if not dataset:
        dataset = SqlaTable(table_name='orders', database=database)
        db.session.add(dataset)
        db.session.flush()
    dataset.fetch_metadata()
    for column in dataset.columns:
        if column.column_name == 'order_date':
            column.is_dttm = True
    dataset.main_dttm_col = 'order_date'
    db.session.flush()
    datasource = f'{dataset.id}__table'
    def metric(label, sql):
        return {'expressionType': 'SQL', 'sqlExpression': sql, 'label': label, 'hasCustomLabel': True, 'optionName': label}
    revenue = metric('Revenue', 'SUM(revenue)')
    orders = metric('Orders', 'COUNT(*)')
    customers = metric('Customers', 'COUNT(DISTINCT customer_id)')
    aov = metric('Average order value', 'SUM(revenue) / COUNT(*)')
    common = {'datasource': datasource, 'adhoc_filters': [], 'time_range': '2026-10-01 : 2026-10-29', 'granularity_sqla': 'order_date', 'color_scheme': 'supersetColors', 'row_limit': 10000}
    specs = [
        ('Total revenue', 'big_number_total', {'metric': revenue, 'y_axis_format': '$,.0f', 'subheader': 'October 2026', 'header_font_size': .4, 'subheader_font_size': .15}),
        ('Orders', 'big_number_total', {'metric': orders, 'y_axis_format': ',.0f', 'subheader': 'Orders placed this month', 'header_font_size': .4, 'subheader_font_size': .15}),
        ('Average order value', 'big_number_total', {'metric': aov, 'y_axis_format': '$,.2f', 'subheader': 'Revenue per order', 'header_font_size': .4, 'subheader_font_size': .15}),
        ('Customers', 'big_number_total', {'metric': customers, 'y_axis_format': ',.0f', 'subheader': 'Unique customers this month', 'header_font_size': .4, 'subheader_font_size': .15}),
        ('Revenue over time', 'echarts_timeseries_line', {'x_axis': 'order_date', 'time_grain_sqla': 'P1D', 'metrics': [revenue], 'groupby': [], 'order_desc': True, 'show_legend': False, 'rich_tooltip': True, 'y_axis_format': '$,.0f', 'markerEnabled': True, 'area': True, 'opacity': .12, 'x_axis_time_format': '%d %b', 'truncateYAxis': False}),
        ('Revenue by channel', 'pie', {'metric': revenue, 'groupby': ['channel'], 'donut': True, 'show_labels': True, 'label_type': 'key_percent', 'show_legend': True, 'legendType': 'plain', 'legendOrientation': 'bottom', 'number_format': '$,.0f', 'innerRadius': 65, 'outerRadius': 85}),
        ('Product performance', 'table', {'query_mode': 'aggregate', 'groupby': ['product', 'category'], 'metrics': [revenue, orders, metric('Units sold', 'SUM(quantity)')], 'all_columns': [], 'percent_metrics': [], 'order_desc': True, 'page_length': 6, 'include_search': False, 'table_timestamp_format': 'smart_date', 'column_config': {'Revenue': {'d3NumberFormat': '$,.0f'}}, 'row_limit': 100}),
    ]
    charts = []
    for title, viz, params in specs:
        chart = db.session.query(Slice).filter(Slice.slice_name.in_([f'Folio · {title}', title])).first()
        if not chart:
            chart = Slice(slice_name=title)
            db.session.add(chart)
        chart.slice_name = title
        chart.datasource_id = dataset.id
        chart.datasource_type = 'table'
        chart.viz_type = viz
        chart.params = json.dumps({**common, **params, 'viz_type': viz})
        db.session.flush()
        chart.params = json.dumps({**json.loads(chart.params), 'slice_id': chart.id})
        charts.append(chart)
    dashboard = db.session.query(Dashboard).filter_by(slug='folio-retail').first()
    if not dashboard:
        dashboard = Dashboard(dashboard_title='Business overview', slug='folio-retail', published=True)
        db.session.add(dashboard)
        db.session.flush()
    dashboard.slices = charts
    layout = {
        'DASHBOARD_VERSION_KEY': 'v2',
        'ROOT_ID': {'type': 'ROOT', 'id': 'ROOT_ID', 'children': ['GRID_ID']},
        'GRID_ID': {'type': 'GRID', 'id': 'GRID_ID', 'children': ['ROW-kpis', 'ROW-main', 'ROW-products'], 'parents': ['ROOT_ID']},
        'HEADER_ID': {'type': 'HEADER', 'id': 'HEADER_ID', 'meta': {'text': 'Business overview'}}
    }
    for row_id, indexes, widths, height in [('ROW-kpis', [0,1,2,3], [3,3,3,3], 18), ('ROW-main', [4,5], [8,4], 43), ('ROW-products', [6], [12], 40)]:
        layout[row_id] = {'type': 'ROW', 'id': row_id, 'children': [], 'parents': ['ROOT_ID', 'GRID_ID'], 'meta': {'background': 'BACKGROUND_TRANSPARENT'}}
        for idx, width in zip(indexes, widths):
            key = f'CHART-{charts[idx].id}'
            layout[row_id]['children'].append(key)
            layout[key] = {'type': 'CHART', 'id': key, 'children': [], 'parents': ['ROOT_ID', 'GRID_ID', row_id], 'meta': {'width': width, 'height': height, 'chartId': charts[idx].id, 'sliceName': specs[idx][0], 'uuid': str(charts[idx].uuid)}}
    dashboard.position_json = json.dumps(layout)
    dashboard.json_metadata = json.dumps({'color_scheme': 'supersetColors', 'label_colors': {'Revenue': '#7056d8', 'Online store': '#7056d8', 'Retail': '#36a7a0', 'Wholesale': '#efb45b'}, 'refresh_frequency': 0, 'expanded_slices': {}, 'timed_refresh_immune_slices': [], 'native_filter_configuration': [
        {'id': 'NATIVE_FILTER-time', 'name': 'Date range', 'filterType': 'filter_time', 'targets': [{}], 'defaultDataMask': {'extraFormData': {'time_range': '2026-10-01 : 2026-10-29'}, 'filterState': {'value': '2026-10-01 : 2026-10-29'}}, 'cascadeParentIds': [], 'scope': {'rootPath': ['ROOT_ID'], 'excluded': []}, 'controlValues': {}},
        {'id': 'NATIVE_FILTER-channel', 'name': 'Sales channel', 'filterType': 'filter_select', 'targets': [{'datasetId': dataset.id, 'column': {'name': 'channel'}}], 'defaultDataMask': {'extraFormData': {}, 'filterState': {}}, 'cascadeParentIds': [], 'scope': {'rootPath': ['ROOT_ID'], 'excluded': []}, 'controlValues': {'enableEmptyFilter': False, 'multiSelect': True, 'searchAllOptions': False, 'inverseSelection': False, 'defaultToFirstItem': False}}
    ]})
    dashboard.css = '''
.dashboard { background: #f7f8fc !important; }
.dashboard-component-chart-holder { border: 1px solid #e9eaf2 !important; border-radius: 12px !important; box-shadow: none !important; }
.dashboard-component-header { color: #24243c; }
.chart-header .header-title { font-weight: 600; }
'''
    embedded = db.session.query(EmbeddedDashboard).filter_by(dashboard_id=dashboard.id).first()
    if not embedded:
        embedded = EmbeddedDashboard(dashboard_id=dashboard.id, allow_domain_list='http://localhost:3017')
        db.session.add(embedded)
        db.session.flush()
    db.session.commit()
    portal = {'dashboardId': str(embedded.uuid), 'supersetDashboardId': dashboard.id, 'serviceUsername': 'portal-service', 'servicePassword': secrets['servicePassword']}
    (LOCAL / 'portal.json').write_text(json.dumps(portal))
    (LOCAL / 'portal.json').chmod(0o600)
    print(f'Created {len(rows)} sample orders, 7 charts, and an embedded dashboard. Credentials are stored in .local/secrets.json.')
