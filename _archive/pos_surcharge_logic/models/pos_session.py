# -*- coding: utf-8 -*-
from odoo import models

class PosSession(models.Model):
    _inherit = 'pos.session'

    def _loader_params_pos_config(self):
        """
        Add the custom surcharge config fields to the fields loaded in JS config.
        """
        result = super()._loader_params_pos_config()
        result['search_params']['fields'].extend([
            'iface_surcharge',
            'surcharge_percentage',
            'surcharge_product_id'
        ])
        return result

    def _loader_params_product_product(self):
        """
        Ensure the surcharge product is loaded in the POS frontend,
        even if it isn't explicitly marked as 'available_in_pos'.
        """
        result = super()._loader_params_product_product()
        if self.config_id.surcharge_product_id:
            surcharge_prod_id = self.config_id.surcharge_product_id.id
            domain = result['search_params']['domain']
            # Make sure it's loaded by prefixing with an OR condition on the product ID
            result['search_params']['domain'] = ['|', ('id', '=', surcharge_prod_id)] + domain
        return result
