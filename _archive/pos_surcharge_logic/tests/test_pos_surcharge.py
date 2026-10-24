# -*- coding: utf-8 -*-
from odoo.tests import common
from odoo.exceptions import ValidationError

class TestPosSurcharge(common.TransactionCase):

    def setUp(self):
        super(TestPosSurcharge, self).setUp()
        self.pos_config = self.env['pos.config'].create({
            'name': 'Test POS shop',
        })
        self.surcharge_product = self.env['product.product'].create({
            'name': 'Test CC Surcharge Fee',
            'type': 'service',
            'available_in_pos': True,
        })

    def test_surcharge_percentage_limits(self):
        """
        Verify that surcharge percentage cannot be negative or exceed the legal cap of 4.0%
        """
        # Test valid percentage
        self.pos_config.write({
            'iface_surcharge': True,
            'surcharge_percentage': 3.5,
            'surcharge_product_id': self.surcharge_product.id
        })
        self.assertEqual(self.pos_config.surcharge_percentage, 3.5)

        # Test negative percentage (should fail)
        with self.assertRaises(ValidationError):
            self.pos_config.write({'surcharge_percentage': -1.0})

        # Test exceeding 4.0% cap (should fail)
        with self.assertRaises(ValidationError):
            self.pos_config.write({'surcharge_percentage': 4.01})

        # Test exactly 4.0% (should pass)
        self.pos_config.write({'surcharge_percentage': 4.0})
        self.assertEqual(self.pos_config.surcharge_percentage, 4.0)

    def test_post_init_hook_setup(self):
        """
        Verify that post_init_hook creates the 'Surcharge Revenue' account
        and 'Credit Card Processing Fee' product properly.
        """
        from ..hooks import post_init_hook
        # Trigger the post_init_hook
        post_init_hook(self.env)
        
        # Verify product created
        product = self.env['product.product'].search([('name', '=', 'Credit Card Processing Fee')], limit=1)
        self.assertTrue(product, "Product 'Credit Card Processing Fee' should exist.")
        self.assertEqual(product.type, 'service')

        # Verify account created
        company = self.env.company
        account = self.env['account.account'].search([
            ('name', '=', 'Surcharge Revenue'),
            ('company_id', '=', company.id)
        ], limit=1)
        self.assertTrue(account, "Account 'Surcharge Revenue' should exist.")
        self.assertEqual(account.account_type, 'income')
