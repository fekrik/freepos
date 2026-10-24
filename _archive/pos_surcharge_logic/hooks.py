# -*- coding: utf-8 -*-
from odoo import api, SUPERUSER_ID

def post_init_hook(env):
    """
    Post-install hook to dynamically:
    1. Create 'Surcharge Revenue' account for each company.
    2. Create 'Credit Card Processing Fee' service product and link the account.
    3. Configure default settings for existing POS configs.
    """
    companies = env['res.company'].search([])
    
    # 1. Create/Find Product
    product = env['product.product'].search([('name', '=', 'Credit Card Processing Fee')], limit=1)
    if not product:
        product = env['product.product'].create({
            'name': 'Credit Card Processing Fee',
            'type': 'service',
            'sale_ok': True,
            'purchase_ok': False,
            'available_in_pos': True,
            'lst_price': 0.0,
        })

    # 2. Setup Surcharge Revenue Account per Company
    for company in companies:
        account = env['account.account'].search([
            ('name', '=', 'Surcharge Revenue'),
            ('company_id', '=', company.id)
        ], limit=1)
        
        if not account:
            # Look for an income account to clone settings/code structure from
            ref_income_account = env['account.account'].search([
                ('account_type', '=', 'income'),
                ('company_id', '=', company.id)
            ], limit=1)
            
            code = '400099'
            if ref_income_account:
                try:
                    base_code = int(ref_income_account.code)
                    code = str(base_code + 1)
                    # Loop to find a unique code
                    while env['account.account'].search([('code', '=', code), ('company_id', '=', company.id)]):
                        code = str(int(code) + 1)
                except ValueError:
                    pass

            account = env['account.account'].create({
                'name': 'Surcharge Revenue',
                'code': code,
                'account_type': 'income',
                'company_id': company.id,
            })
            
        # Set the product income account to the Surcharge Revenue account for this company
        product.with_company(company).property_account_income_id = account.id

    # 3. Configure default POS config settings
    pos_configs = env['pos.config'].search([])
    for config in pos_configs:
        config.write({
            'iface_surcharge': True,
            'surcharge_percentage': 3.99,
            'surcharge_product_id': product.id,
        })
