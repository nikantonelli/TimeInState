Ext.define('typesToChoose', {
    extend: 'Ext.data.Model',
    fields: [
        {name: 'name',    type: 'string' },
        {name: '_ref',    type: 'string' },
        {name: 'lbapi',   type: 'string' },
        {name: 'field',   type: 'string' }
    ],

    // To help the rallycombobox, we need to provide some equivalents
    getNonCollectionFields: function() {
        return this.fields;
    }
});

Ext.define('Rally.app.CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    stateful: true,
    typeStore: null,
    config: {
        defaultSettings: {
            artefactType: 'hierarchicalrequirement',
            piType: 'Portfolioitem/Feature',
        }
    },

    getSettingsFields: function() {

        var returnVal = [{
                xtype: 'rallycombobox',
                name: 'artefactType',
                fieldLabel: 'Artefact Type:',
                stateful: true,
                stateId: this.getContext().getScopedStateId('artefactcombo'),
                storeType: 'Ext.data.Store',
                store: this.store,
                displayField: 'name',
                labelAlign: 'right',
                labelWidth: 150

            },
            {
                xtype: 'rallyportfolioitemtypecombobox',
                fieldLabel: 'PI Type (if selected):',
                stateful: true,
                stateId: this.getContext().getScopedStateId('picombo'),
                name: 'piType',
                labelAlign: 'right',
                labelWidth: 150,
                valueField: 'TypePath',
            }
        ];

        return returnVal;

    },


    items: [
    {
            xtype: 'container',
            id: 'headerBox',
            layout: 'column',
            border: 5,
            style: {
                borderColor: Rally.util.Colors.cyan,
                borderStyle: 'solid'
            },
            items: [
                {
                    xtype: 'rallydatefield',
                    margin: 10,
                    format: 'D d M Y',
                    id: 'StartDate',
                    stateful: true,
                    fieldLabel: 'Start Date',
                    value: Ext.Date.subtract( new Date(), Ext.Date.DAY, 90) // 90 days of previous iterations
                },
                {
                    xtype: 'rallydatefield',
                    margin: 10,
                    fieldLabel: 'End Date',
                    format: 'D d M Y',
                    stateful: true,
                    id: 'EndDate',
                    value: new Date()
                }
            ]
        }
    ],

    _getCalculatorConfig: function() {
        return ({
            'endDate': Ext.getCmp('EndDate').getValue(),
            'startDate': Ext.getCmp('StartDate').getValue(),
            'granularity': 'day'
        });
    },

    _getSeriesData: function(app) {
        //Find the field name for the relevant type in our little table because of the inconsistencies of WSAPI/LBAPI
        var typeRecord = _.find(this.possibleTypes, {'_ref' : app.artefactType});
        var typeName = typeRecord.lbapi;
        if (typeName === 'PortfolioItem') {
            typeName = app.piType;
        }

        var snapshots = Ext.create('Rally.data.lookback.SnapshotStore', {
            autoLoad: false,
            defaultFetch: ['ObjectID', '_ValidFrom', '_ValidTo' ],
            compress: true,
            removeUnauthorizedSnapshots: true,
            pageSize: 15000,
            fetch: ['FormattedID', 'Name', typeRecord.field, '_PreviousValues.'+typeRecord.field],
            hydrate: [typeRecord.field, '_PreviousValues.'+typeRecord.field], //Hydrate  the field we are looking for first (used in _gotSnapShots() )
            filters: [
                {
                    property: '_TypeHierarchy',
                    operator: 'in',
                    value: [typeName]
                },
                {
                    property: '_PreviousValues.'+typeRecord.field,
                    operator: 'in',
                    value: app.categoryData
                },
                {
                    property: '_ValidFrom',
                    operator: '>',
                    value:  Ext.Date.format(Ext.getCmp('StartDate').value, "Y-m-d\\TH:i:s.u\\Z")
                },
                {
                    property: '_ValidTo',
                    operator: '<',
                    value: Ext.Date.format(Ext.getCmp('EndDate').value, "Y-m-d\\TH:i:s.u\\Z")
                }

            ],
            sorters: [
                {
                    property: 'ObjectID',
                    direction: 'ASC'
                },
                {
                    property: '_ValidFrom',
                    direction: 'ASC'
                }
            ],
            listeners: {
                load: app._gotSnapShots,
                scope: app
            },

            storeConfig: {
                limit: Infinity
            }
        });

        snapshots.load();
    },

    _findItem: function( data, fieldsToMatch) {
        var keys = _.keys(fieldsToMatch);
        var keylength = keys.length;

        if ((data !== null) && (keylength !== 0))
        {
            for (var j = 0; j < data.length; j++) {
                var record = data[j];

                var obj = Object(record.data);   //WHo knows why this is in the example code....
                var i = 0;
                for ( i = 0; i< keylength; i++ ) {
                    var key = keys[i];
                    if (fieldsToMatch[key] !== obj[key] || !(key in obj)) { break; }
                }

                //If we get here after checking all the keys, then found the right stuff in this record
                if ( i >= keylength) return record;
            }
        }
        return null;
    },

    _gotSnapShots: function( store, data, success) {

        var app = this;
        console.log('Snapshots received: ', data.length);

        //For all the snapshots we have, check the state change regardless of the 'Project' changing.
        //The snapshots will be all those that states start and finish within the timebox specified.

        //We need to merge the 'project' changes for each Object

        // Then we have the issue of objects that move back and forth between states.
        // So, let's total up how long each object was in a particular state regardless of when it was moved project

        var lastDataItem = null;
        var savedItems = [];
        var hydratedField = store.hydrate[0];

        _.each(data, function(item) {
            var foundItem = null;
            var findThese = {};
            findThese.ObjectID = item.get('ObjectID');
            findThese[hydratedField] = item.get(hydratedField);

            d1 = new Date(item.get('_ValidFrom'));
            d2 = new Date(item.get('_ValidTo'));

            if ((foundItem = app._findItem(savedItems, findThese)
                )) {
                //It's in savedItems, so move its end date out by the amount in the new item
                //The _ValidTo and _ValidFrom fields are strings, so we need to convert, manipulate and place back.
                d_ = foundItem.get('TimeDiff');
                d3 = (d_?d_:0);
                foundItem.set('TimeDiff', d3 + (d2 - d1));
            }
            else {
                //Don't know about it, so add to the saveitems array
                item.set('TimeDiff', d2 - d1);
                savedItems.push(item);
            }
        });
        
        console.log('Saved items: ', savedItems);
        //Let's now scan the saveItems to generate some stats

        //Create a matching set of artefactData to categoryData
        for (var i = 0; i < app.categoryData.length; i++ ){ 
            console.log('Creating artefactData array for ', app.categoryData[i]);
            app.artefactData[i] = []; 
        }

        //First collect all the time diffs (in ms)
        _.each (savedItems, function(item) {

            //Deal with an empty field - Rally changes these to 'None' in the allowed Values
            if (item.data[hydratedField] === '' ) { item.data[hydratedField] = 'None'; }

            //Find the item state in the category list.
            if ((index = app.categoryData.indexOf(item.data[hydratedField])) >= 0) {

                //We have an issue with people creating and moving in the same action.
                //It skews the data to show that the minimum is 'zero'. To get around this, we
                //only save data where the granularity is  more than one hour.

                if (item.data.TimeDiff > (60*60*1000)) {
                    app.artefactData[index].push(item.data.TimeDiff);
                }
            }
        });

        var dataArray = [];

        //For each entry, calculate some 'real' stats ready for diisplay
        _.each( app.artefactData, function(adArray) {
            sortedArray = _.sortBy(adArray);
            var stats = [];
            var sum = 0;
            var i = 0;

            // If we filter off the smaller timeboxes
            if ( adArray.length > 0){
                for (i = 0; i < adArray.length; i++) { sum += adArray[i]; }
                stats.push(Math.floor(_.min(adArray)/864000)/100);
                stats.push(Math.floor(sortedArray[Math.floor(i*0.25)]/864000)/100);
                stats.push(Math.floor(sum/(864000*adArray.length))/100);
                stats.push(Math.floor(sortedArray[Math.floor(i*0.75)]/864000)/100);
                stats.push(Math.floor(_.max(adArray)/864000)/100);
                dataArray.push(stats);
            }
        });

        //So we have the same order of samples as the categoryData

        app.seriesData =
            [{
                name: hydratedField,
                data: dataArray
            }];
            app._drawChart();
    },

    //Hold  blank data for the graph until load

    artefactType: null,

    artefactData: {},

    categoryData: [],

    seriesData: [],

    possibleTypes: [
        { name: 'Stories',   _ref: 'hierarchicalrequirement',   lbapi: 'HierarchicalRequirement',  field: 'ScheduleState' },
        { name: 'Defects',   _ref: 'defect',                    lbapi: 'Defect',                   field: 'ScheduleState'    },
        { name: 'Tasks',     _ref: 'task',                      lbapi: 'Task',                     field: 'State'   },
        { name: 'TestCases', _ref: 'testcase',                  lbapi: 'TestCase',                 field: 'LastVerdict'   },
        { name: 'Portfolio', _ref: 'portfolioitem',             lbapi: 'PortfolioItem',            field: 'State' }
    ],

    _redrawChart: function() {
        var chart = null;

        if ( (chart = Ext.getCmp('tipChart')) ) {
            chart.destroy();
        }

        this.artefactData = {};
        this.seriesData = [];
        this.categoryData = Ext.getCmp('fieldValues').value;
        console.log('Setting category data of: ', this, ' to ',this.categoryData);
        this._getSeriesData(this);
    },

    _drawChart: function() {
        var hc = Ext.create('Rally.ui.chart.Chart', {
            id: 'tipChart',
            loadMask: false,
            chartData:{
                categories: this.categoryData,
                series: this.seriesData
            },

             chartConfig: {
                chart: {
                    type: 'boxplot',
                    marginRight: 130,
                    marginBottom: 25
                },
                title: {
                    text: 'Time In State for Period',
                    x: -20 //center
                },
                subtitle: {
                    text: 'Min, 25%, Average, 75%, Max',
                    x: -20
                },
                yAxis: {
                    min: 0,
                    title: {
                        text: 'Days in State'
                    }
                },

                  plotOptions: {
                    columnrange: {
                        dataLabels: {
                            enabled: true,
                            formatter: function () {
                                return this.y + 'days';
                            }
                        }
                    }
                  },

                  legend: {
                    enabled: false
                  }
          }
       });

        this.add(hc);
    },

//    onSettingsUpdate: function() {
//        debugger;
//        this._redrawChart();
//    },


    launch: function() {
        var app = this;

//Ext.util.Observable.capture( app, function(event) { console.log( 'app:', event);});

        //Attach some callbacks to the date fields, so we can detect user change

        Ext.getCmp('StartDate').on('change', app._redrawChart, app);
        Ext.getCmp('EndDate').on('change', app._redrawChart, app);

        //Create a store to house our records
        this.store = Ext.create('Ext.data.Store',{
                model: 'typesToChoose',
                data:   app.possibleTypes,
                proxy: 'memory',
                autoLoad: false

        });

        //This saves us a lot of getSetting() calls.
        app.artefactType = app.getSetting('artefactType') || 'hierarchicalrequirement';
        app.piType = app.getSetting('piType') || 'Portfolioitem/Feature';

        //Now that we know what type, give the user the option of choosing which
        //field to work from.
        var typeRecord = _.find(this.possibleTypes, {'_ref' : app.artefactType});
        //Add the field selector for the user
        var typeName = typeRecord._ref;
        if (typeName === 'portfolioitem') {
            typeName = app.piType.toLowerCase();
        }

        var fieldSelector = Ext.create('Rally.ui.combobox.FieldComboBox', {
                model: typeName,
                autoScroll: true,
                stateful: true,
                stateId: this.getContext().getScopedStateId('fieldcombo'),
                fieldLabel: typeRecord.name +  ' Field:',
                id: 'fieldSelection',
                margin: 10,
                listeners: {
                        select: function(combo) {
                            app.saveState();
                            typeRecord.field = combo.getRecord().get('fieldDefinition').name;
                            Ext.getCmp('fieldValues').fireEvent('fieldselected', combo.getRecord().get('fieldDefinition'));
                        },
                        ready: function(combo) {
                            combo.store.filterBy(function(record) {
                                var attr = record.get('fieldDefinition').attributeDefinition;
                                return attr && attr.Constrained && attr.AttributeType !== 'COLLECTION';
//                                return attr && attr.Constrained && attr.AttributeType !== 'OBJECT' && attr.AttributeType !== 'COLLECTION';
                            });
                            combo.setValue(typeRecord.field);
                        }
                    }

            }
        );

        Ext.getCmp('headerBox').add( fieldSelector);
        app.on('fieldValuesSelected', app._redrawChart, app);

        //Now set up the field selector for this type

        var fieldValueSelector = Ext.create('Rally.ui.combobox.FieldValueComboBox', {
            id: 'fieldValues',
            model: typeName,
            stateful: true,
            stateId: this.getContext().getScopedStateId('fieldvaluecombo'),
            field: typeRecord.field,
            fieldLabel: 'Field Values: ',
            valueField: 'name',
            multiSelect: true,
            margin: 10,
            listeners: {

                //This is a bit like a restart, so we will re-initialise to all selected
                fieldselected: function(type) {
                    this.setField(type);
                    app.saveState();
                },
            }
        });

        Ext.getCmp('headerBox').add( fieldValueSelector );

// Ext.util.Observable.capture( fieldSelector, function(event) { console.log( 'field:', event);});
// Ext.util.Observable.capture( fieldValueSelector, function(event) { console.log( 'value:', event);});

        Ext.getCmp('headerBox').add({
            xtype: 'rallybutton',
            text: 'Draw',
            margin: 10,
            handler: app._redrawChart,
            scope: app
        });
    }

});
