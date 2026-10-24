# -*- coding: utf-8 -*-
{
    'name': 'POS Surcharge Logic',
    'version': '1.0.0',
    'category': 'Point of Sale',
    'summary': 'Inject a configurable surcharge/service fee on Credit Card payment methods in POS.',
    'description': """
        This module implements dual-pricing/surcharge logic in Odoo POS.
        When the user selects the 'Credit Card' payment method, a service fee is dynamically added to the order.
        If the user switches the payment method back to Cash or other payment methods, the fee is automatically removed.
    """,
    'author': 'Antigravity',
    'depends': ['point_of_sale'],
    'data': [
        'views/res_config_settings_views.xml',
    ],
    'assets': {
        'point_of_sale._assets_pos': [
            'pos_surcharge_logic/static/src/js/payment_screen_patch.js',
        ],
    },
    'post_init_hook': 'post_init_hook',
    'installable': True,
    'application': False,
    'auto_install': False,
    'license': 'LGPL-3',
}
